import { extractErrorCode } from '@aliasvault/client/api/errors/AppErrorCodes';
import { ClientUpgradeRequiredError } from '@aliasvault/client/api/errors/ClientUpgradeRequiredError';
import { MasterPasswordService } from '@aliasvault/client/auth/MasterPasswordService';
import { SrpAuthService } from '@aliasvault/client/auth/SrpAuthService';
import { SrpLoginService } from '@aliasvault/client/auth/SrpLoginService';
import { VaultKeyService } from '@aliasvault/client/auth/VaultKeyService';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import ServerValidationErrors from '@/components/alerts/ServerValidationErrors';
import PasswordInputField from '@/components/auth/PasswordInputField';
import FooterLogin from '@/components/layout/FooterLogin';
import BoldLoadingIndicator from '@/components/loading/BoldLoadingIndicator';
import { useAuth } from '@/context/AuthContext';
import { useDb } from '@/context/DbContext';
import { useLoading } from '@/context/LoadingContext';
import { useNotifications } from '@/context/NotificationContext';
import { useWebApi } from '@/context/WebApiContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { WebAuthnNotSupportedError, WebAuthnService } from '@/utils/WebAuthnService';
import { vaultStore } from '@/vault/VaultStore';

/**
 * Unlock page: derive the vault key from the master password again after a lock or page reload.
 */
const Unlock: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const auth = useAuth();
  const dbContext = useDb();
  const webApi = useWebApi();
  const notifications = useNotifications();
  const { showLoading, hideLoading } = useLoading();
  const srpUtil = useMemo(() => new SrpLoginService(webApi), [webApi]);
  usePageTitle(t('pages.auth.unlock.UnlockButton'));

  const { skipWebAuthn } = useParams<{ skipWebAuthn?: string }>();
  const [isLoading, setIsLoading] = useState(true);
  const [isWebAuthnLoading, setIsWebAuthnLoading] = useState(false);
  const [showWebAuthnButton, setShowWebAuthnButton] = useState(false);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const passwordRef = useRef<HTMLInputElement>(null);
  const hasInitialized = useRef(false);

  const username = auth.username;

  /**
   * Decrypt the unlock key with the passkey and open the vault.
   */
  const unlockWithWebAuthn = useCallback(async (): Promise<void> => {
    if (!WebAuthnService.isEnabled()) {
      return;
    }
    setIsWebAuthnLoading(true);
    try {
      await WebAuthnService.unlock();
      navigate('/sync', { replace: true });
    } catch (err) {
      if (err instanceof WebAuthnNotSupportedError) {
        notifications.addErrorMessage(t('pages.auth.unlock.WebAuthnNotSupportedError'), true);
      } else {
        console.error('An error occurred while trying to unlock the vault with WebAuthn.', err);
      }
    } finally {
      setIsWebAuthnLoading(false);
    }
  }, [navigate, notifications, t]);

  /**
   * Check the session with the server; a rejected token logs the user out through the API service.
   */
  useEffect(() => {
    if (!auth.isInitialized || hasInitialized.current) {
      return;
    }
    hasInitialized.current = true;

    /**
     * Status check on page load.
     */
    const statusCheck = async (): Promise<void> => {
      if (!auth.isLoggedIn) {
        notifications.addErrorMessage(t('pages.auth.unlock.SessionTimedOutError'));
        navigate('/user/login', { replace: true });
        return;
      }

      try {
        const status = await webApi.getStatus();
        if (status.serverVersion === '0.0.0') {
          await dbContext.setIsOffline(true);
        } else {
          const statusError = webApi.validateStatusResponse(status);
          if (statusError !== null) {
            await auth.logout({ errorMessage: t('common.errors.' + statusError) });
            return;
          }
          await dbContext.setIsOffline(false);
        }
      } catch (err) {
        if (err instanceof ClientUpgradeRequiredError) {
          await auth.logout({ errorMessage: t('common.errors.clientVersionNotSupported') });
          return;
        }
        setErrors([t('pages.auth.unlock.ConnectionFailedError')]);
      }

      setIsLoading(false);

      // A passkey unlocks right away unless the user came here to type the password instead.
      const passkeyEnabled = WebAuthnService.isEnabled();
      setShowWebAuthnButton(passkeyEnabled);
      if (passkeyEnabled && skipWebAuthn !== 'true') {
        await unlockWithWebAuthn();
      }
    };
    void statusCheck();
  }, [auth, dbContext, webApi, notifications, navigate, t, skipWebAuthn, unlockWithWebAuthn]);

  useEffect(() => {
    if (!isLoading && !isWebAuthnLoading && !showWebAuthnButton) {
      const timer = setTimeout(() => passwordRef.current?.focus(), 100);
      return (): void => clearTimeout(timer);
    }
  }, [isLoading, isWebAuthnLoading, showWebAuthnButton]);

  /**
   * Derive the KEK from the password and open the vault key chain: online through the server, offline through the
   * cached key material.
   */
  const unlockSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!username) {
      return;
    }
    showLoading(t('pages.auth.unlock.UnlockingVaultMessage'));
    setErrors([]);

    try {
      let unlockKey: string;
      if (dbContext.getIsOffline()) {
        const params = await MasterPasswordService.getStoredDerivationParams();
        if (!params) {
          throw new Error(t('pages.auth.unlock.ConnectionFailedError'));
        }
        const prepared = await SrpAuthService.prepareCredentials(password, params.salt, params.encryptionSettings);
        unlockKey = prepared.passwordHashBase64;
        // Throws an unlock-key-rejected (E-206) error on a wrong password.
        await VaultKeyService.verifyUnlockKey(unlockKey);
      } else {
        const loginResponse = await srpUtil.initiateLogin(username);
        const prepared = await SrpAuthService.prepareCredentials(password, loginResponse.salt, loginResponse.encryptionSettings);
        await vaultStore.storeUnlockKeyDerivationParams({ salt: loginResponse.salt, encryptionType: loginResponse.encryptionType, encryptionSettings: loginResponse.encryptionSettings });
        unlockKey = prepared.passwordHashBase64;
        // Throws an unlock-key-rejected (E-206) error on a wrong password.
        await VaultKeyService.refreshKeyChain(unlockKey, webApi);
      }

      await vaultStore.storeUnlockKey(unlockKey);
      navigate('/sync', { replace: true });
    } catch (err) {
      console.error('Unlock error:', err);
      const code = err instanceof Error ? extractErrorCode(err.message) : null;
      if (await VaultKeyService.isWrongUnlockKey(code)) {
        setErrors([t('pages.auth.unlock.IncorrectPasswordError')]);
      } else if (import.meta.env.DEV && err instanceof Error) {
        setErrors([err.message]);
      } else {
        setErrors([t('pages.auth.unlock.GenericUnlockError')]);
      }
    } finally {
      hideLoading();
    }
  };

  if (isLoading) {
    return (
      <>
        <ServerValidationErrors errors={errors} />
        <BoldLoadingIndicator />
      </>
    );
  }

  if (isWebAuthnLoading) {
    return (
      <>
        <ServerValidationErrors errors={errors} />
        <BoldLoadingIndicator />
        <p className="mt-6 text-center font-normal text-gray-500 dark:text-gray-400">{t('pages.auth.unlock.LoggingInWithWebAuthn')}</p>
      </>
    );
  }

  return (
    <>
      <div className="flex space-x-4">
        <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center">
          <span className="text-primary-600 dark:text-primary-400 text-base font-medium">
            {username?.charAt(0).toUpperCase() ?? '?'}
          </span>
        </div>
        <h2 className="mb-3 text-2xl font-bold text-gray-900 dark:text-white">{username}</h2>
      </div>

      {showWebAuthnButton ? (
        <div className="mb-6">
          <p className="text-base font-normal text-gray-500 dark:text-gray-400 mb-4">{t('pages.auth.unlock.QuickUnlockDescription')}</p>

          <ServerValidationErrors errors={errors} />

          <div className="flex space-x-4">
            <button type="button" onClick={() => void unlockWithWebAuthn()} className="flex-grow inline-flex items-center justify-center px-5 py-2 text-base font-medium text-center text-white rounded-lg bg-primary-700 hover:bg-primary-800 focus:ring-4 focus:ring-primary-300 sm:w-auto dark:bg-primary-600 dark:hover:bg-primary-700 dark:focus:ring-primary-800">
              <svg className="w-5 h-5 mr-2 -ml-1" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z"></path><path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd"></path></svg>
              {t('pages.auth.unlock.UnlockWithWebAuthn')}
            </button>
            <button type="button" onClick={() => setShowWebAuthnButton(false)} className="inline-flex items-center justify-center px-5 py-2 text-base font-medium text-center text-gray-900 rounded-lg border border-gray-300 hover:bg-gray-100 focus:ring-4 focus:ring-gray-100 dark:text-white dark:border-gray-700 dark:hover:bg-gray-700 dark:focus:ring-gray-800">
              {t('pages.auth.unlock.UnlockWithPassword')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-base font-normal text-gray-500 dark:text-gray-400 mb-4">
            {t('pages.auth.unlock.EnterMasterPasswordDescription')}
          </p>

          <ServerValidationErrors errors={errors} />
        </>
      )}

      <form onSubmit={unlockSubmit} className="mt-4 space-y-6" av-enable="true" av-suppress-save="true">
        <div>
          <label htmlFor="password" className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">{t('pages.auth.unlock.YourPasswordLabel')}</label>
          <PasswordInputField ref={passwordRef} id="password" value={password} onValueChange={setPassword} placeholder="••••••••" />
        </div>

        <button type="submit" id="unlock-button" className="w-full px-5 py-2 text-base font-medium text-center text-white bg-primary-700 rounded-lg hover:bg-primary-800 focus:ring-4 focus:ring-primary-300 dark:bg-primary-600 dark:hover:bg-primary-700 dark:focus:ring-primary-800 flex items-center justify-center gap-2">
          {t('pages.auth.unlock.UnlockButton')}
        </button>
      </form>

      <div className="text-sm text-center font-medium text-gray-500 dark:text-gray-400 mt-6">
        {t('pages.auth.unlock.SwitchAccountsText')} <Link to="/user/logout" className="text-primary-700 hover:underline dark:text-primary-500">{t('pages.auth.unlock.LogOutLink')}</Link>
      </div>

      <FooterLogin />
    </>
  );
};

export default Unlock;
