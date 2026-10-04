import { ApiAuthError } from '@aliasvault/client/api/errors/ApiAuthError';
import { extractErrorCode } from '@aliasvault/client/api/errors/AppErrorCodes';
import { ClientUpgradeRequiredError } from '@aliasvault/client/api/errors/ClientUpgradeRequiredError';
import { describeAuthError, formatErrorMessage } from '@aliasvault/client/auth/AuthErrorMessage';
import { MasterPasswordService } from '@aliasvault/client/auth/MasterPasswordService';
import { SrpAuthService } from '@aliasvault/client/auth/SrpAuthService';
import { SrpLoginService } from '@aliasvault/client/auth/SrpLoginService';
import { VaultKeyService } from '@aliasvault/client/auth/VaultKeyService';
import { logoutReasonKey } from '@aliasvault/client/sync/VaultSync';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import CriticalErrorPanel from '@/components/alerts/CriticalErrorPanel';
import ServerValidationErrors from '@/components/alerts/ServerValidationErrors';
import MobileUnlockModal from '@/components/auth/MobileUnlockModal';
import PasswordInputField from '@/components/auth/PasswordInputField';
import FooterLogin from '@/components/layout/FooterLogin';
import BoldLoadingIndicator from '@/components/loading/BoldLoadingIndicator';
import Button from '@/components/shared/Button';
import FormLabel from '@/components/shared/FormLabel';
import Icon from '@/components/shared/Icon';
import { useAuth } from '@/context/AuthContext';
import { useDb } from '@/context/DbContext';
import { useLoading } from '@/context/LoadingContext';
import { useNotifications } from '@/context/NotificationContext';
import { useWebApi } from '@/context/WebApiContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { focusWhenVisible } from '@/utils/FocusWhenVisible';
import { WebAuthnNotSupportedError, WebAuthnService } from '@/utils/WebAuthnService';
import { vaultStore } from '@/vault/VaultStore';

import type { MobileLoginResult } from '@aliasvault/client/auth/MobileLoginService';

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
  usePageTitle(t('auth.unlockPage.unlockButton'));

  const { skipWebAuthn } = useParams<{ skipWebAuthn?: string }>();
  const [isLoading, setIsLoading] = useState(true);
  const [isWebAuthnLoading, setIsWebAuthnLoading] = useState(false);
  const [showWebAuthnButton, setShowWebAuthnButton] = useState(false);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [showMobileUnlockModal, setShowMobileUnlockModal] = useState(false);
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
        notifications.addErrorMessage(t('auth.unlockPage.webAuthnNotSupportedError'), true);
      } else if (!(err instanceof DOMException && err.name === 'NotAllowedError')) {
        console.error('An error occurred while trying to unlock the vault with WebAuthn.', err);
      }
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
        notifications.addErrorMessage(t('common.errors.sessionExpired'));
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
            await auth.logout({ errorMessage: t(logoutReasonKey(statusError)) });
            navigate('/user/login', { replace: true });
            return;
          }
          await dbContext.setIsOffline(false);
        }
      } catch (err) {
        if (err instanceof ClientUpgradeRequiredError) {
          await auth.logout({ errorMessage: t('common.errors.clientNotSupported') });
          navigate('/user/login', { replace: true });
          return;
        }
        if (err instanceof ApiAuthError) {
          navigate('/user/login', { replace: true });
          return;
        }
        setErrors([t('auth.unlockPage.connectionFailedError')]);
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
      return focusWhenVisible(() => passwordRef.current);
    }
  }, [isLoading, isWebAuthnLoading, showWebAuthnButton]);

  /**
   * Switch from the passkey option to the password form.
   */
  const showPasswordUnlock = (): void => {
    setShowWebAuthnButton(false);
  };

  /**
   * Derive the KEK from the password and open the vault key chain.
   */
  const unlockSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!username) {
      return;
    }
    showLoading(t('app.status.unlockingVault'));
    setErrors([]);

    try {
      let unlockKey: string;
      if (dbContext.getIsOffline()) {
        const params = await MasterPasswordService.getStoredDerivationParams();
        if (!params) {
          throw new Error(t('auth.unlockPage.connectionFailedError'));
        }
        const prepared = await SrpAuthService.prepareCredentials(password, params.salt, params.encryptionType, params.encryptionSettings);
        // Throws an unlock-key-rejected (E-206) error on a wrong password.
        unlockKey = await VaultKeyService.verifyUnlockKey(prepared.passwordHashBase64);
      } else {
        const loginResponse = await srpUtil.initiateLogin(username);
        const prepared = await SrpAuthService.prepareCredentials(password, loginResponse.salt, loginResponse.encryptionType, loginResponse.encryptionSettings);
        await vaultStore.storeUnlockKeyDerivationParams({ salt: loginResponse.salt, encryptionType: loginResponse.encryptionType, encryptionSettings: loginResponse.encryptionSettings });
        // Throws an unlock-key-rejected (E-206) error on a wrong password.
        unlockKey = await VaultKeyService.refreshKeyChain(prepared.passwordHashBase64, webApi);
      }

      await vaultStore.storeUnlockKey(unlockKey);
      navigate('/sync', { replace: true });
    } catch (err) {
      console.error('Unlock error:', err);
      if (err instanceof ApiAuthError) {
        navigate('/user/login', { replace: true });
        return;
      }
      const message = await describeAuthError(err, { fallback: 'auth.loginForm.loginErrorMessage' });
      if (import.meta.env.DEV && err instanceof Error && message.key === 'auth.loginForm.loginErrorMessage') {
        setErrors([err.message]);
      } else {
        setErrors([formatErrorMessage(message, t)]);
      }
    } finally {
      hideLoading();
    }
  };

  /**
   * Replace the session with the one the mobile app approved and open the vault with the unlock key it sent.
   */
  const handleMobileUnlockSuccess = async (result: MobileLoginResult): Promise<void> => {
    showLoading(t('app.status.unlockingVault'));
    setErrors([]);
    setShowMobileUnlockModal(false);

    try {
      // The approval must belong to the account of the current session.
      if (username && result.username.toLowerCase() !== username.toLowerCase()) {
        setErrors([t('apiErrors.USERNAME_MISMATCH')]);
        return;
      }

      // Revoke the tokens of the current session before storing the new ones.
      await webApi.revokeCurrentTokens();
      await auth.setAuthTokens(result.username, result.token, result.refreshToken);

      // Throws an unlock-key-rejected (E-206) error if the key does not open the key chain.
      const storedKey = await VaultKeyService.refreshKeyChain(result.unlockKey, webApi);
      await vaultStore.storeUnlockKeyDerivationParams({ salt: result.salt, encryptionType: result.encryptionType, encryptionSettings: result.encryptionSettings });
      await vaultStore.storeUnlockKey(storedKey);
      navigate('/sync', { replace: true });
    } catch (err) {
      console.error('Mobile unlock error:', err);
      const message = await describeAuthError(err, { fallback: 'auth.loginForm.loginErrorMessage' });
      if (err instanceof ClientUpgradeRequiredError) {
        await auth.logout({ errorMessage: formatErrorMessage(message, t) });
        navigate('/user/login', { replace: true });
      } else if (import.meta.env.DEV && err instanceof Error && message.key === 'auth.loginForm.loginErrorMessage') {
        setErrors([err.message]);
      } else {
        setErrors([formatErrorMessage(message, t)]);
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
        <p className="mt-6 text-center font-normal text-gray-500 dark:text-gray-400">{t('auth.unlockPage.loggingInWithWebAuthn')}</p>
      </>
    );
  }

  // A coded error is critical: it replaces the form.
  const criticalError = errors.find(error => extractErrorCode(error) !== null);
  if (criticalError) {
    const logoutLink = <>{t('auth.switchAccounts')} <Link to="/user/logout" className="text-primary-700 hover:underline dark:text-primary-500">{t('web.topMenu.logOut')}</Link></>;
    return <CriticalErrorPanel report={criticalError} onAction={() => setErrors([])} footer={logoutLink} />;
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
          <p className="text-base font-normal text-gray-500 dark:text-gray-400 mb-4">{t('auth.unlockPage.quickUnlockDescription')}</p>

          <ServerValidationErrors errors={errors} className="mb-4" />

          <div className="flex space-x-4">
            <button type="button" onClick={() => void unlockWithWebAuthn()} className="flex-grow inline-flex items-center justify-center px-5 py-2 text-base font-medium text-center text-white rounded-lg bg-primary-700 hover:bg-primary-800 focus:ring-4 focus:ring-primary-300 sm:w-auto dark:bg-primary-600 dark:hover:bg-primary-700 dark:focus:ring-primary-800">
              <Icon name="pencil-alt" className="w-5 h-5 mr-2 -ml-1" />
              {t('auth.unlockPage.unlockWithWebAuthn')}
            </button>
            <button type="button" onClick={showPasswordUnlock} className="inline-flex items-center justify-center px-5 py-2 text-base font-medium text-center text-gray-900 rounded-lg border border-gray-300 hover:bg-gray-100 focus:ring-4 focus:ring-gray-100 dark:text-white dark:border-gray-700 dark:hover:bg-gray-700 dark:focus:ring-gray-800">
              {t('auth.unlockWithPassword')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-base font-normal text-gray-500 dark:text-gray-400 mb-4">
            {t('auth.unlockPage.enterMasterPasswordDescription')}
          </p>

          <ServerValidationErrors errors={errors} />

          <form onSubmit={unlockSubmit} className="mt-4 space-y-6" av-enable="true" av-suppress-save="true">
            <div>
              <FormLabel htmlFor="password">{t('auth.register.passwordLabel')}</FormLabel>
              <PasswordInputField ref={passwordRef} id="password" value={password} onValueChange={setPassword} placeholder="••••••••" />
            </div>

            <Button type="submit" id="unlock-button" size="lg" display="flex" additionalClasses="w-full">{t('auth.unlockPage.unlockButton')}</Button>
          </form>
        </>
      )}

      {!dbContext.isOffline && (
        <Button id="mobile-unlock-button" onClick={() => setShowMobileUnlockModal(true)} color="outline" size="lg" display="flex" additionalClasses="hidden md:flex w-full mt-4">
          <Icon name="device-mobile" className="w-5 h-5" />
          {t('auth.unlockPage.unlockWithMobileButton')}
        </Button>
      )}

      <div className="text-sm text-center font-medium text-gray-500 dark:text-gray-400 mt-6">
        {t('auth.switchAccounts')} <Link to="/user/logout" className="text-primary-700 hover:underline dark:text-primary-500">{t('web.topMenu.logOut')}</Link>
      </div>

      <FooterLogin />

      <MobileUnlockModal isOpen={showMobileUnlockModal} mode="unlock" onClose={() => setShowMobileUnlockModal(false)} onSuccess={handleMobileUnlockSuccess} />
    </>
  );
};

export default Unlock;
