import { ClientUpgradeRequiredError } from '@aliasvault/client/api/errors/ClientUpgradeRequiredError';
import { ServerUpdateRequiredError } from '@aliasvault/client/api/errors/ServerUpdateRequiredError';
import { VaultProcessingError } from '@aliasvault/client/api/errors/VaultProcessingError';
import { describeAuthError, formatErrorMessage } from '@aliasvault/client/auth/AuthErrorMessage';
import { VaultKeyService } from '@aliasvault/client/auth/VaultKeyService';
import { AppInfo } from '@aliasvault/client/platform/AppInfo';
import { syncErrorMessage } from '@aliasvault/client/sync/SyncErrorMessage';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import Button from '@/entrypoints/popup/components/Button';
import MobileUnlockModal from '@/entrypoints/popup/components/Dialogs/MobileUnlockModal';
import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIcon, HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import Icon from '@/entrypoints/popup/components/Icons/Icon';
import LoginServerInfo from '@/entrypoints/popup/components/LoginServerInfo';
import VaultErrorReport from '@/entrypoints/popup/components/VaultErrorReport';
import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';
import { useFinishBackgroundAuth } from '@/entrypoints/popup/hooks/useFinishBackgroundAuth';
import { PopoutUtility } from '@/entrypoints/popup/utils/PopoutUtility';

import { StorageKeys } from '@/utils/constants/storageKeys';
import { logFailure } from '@/utils/Diagnostics';
import { sendMessage } from '@/utils/messaging/ExtensionMessaging';
import type { BackgroundAuthResult } from '@/utils/types/messaging/BackgroundAuthResult';

import { vaultStateEvents } from '@/events/VaultStateEvents';

import type { MobileLoginResult } from '@aliasvault/client/auth/MobileLoginService';
import type { UnlockKeyDerivationParams } from '@aliasvault/models/metadata';

import { storage } from '#imports';

/** Track if username prefill has been attempted (only do it once on mount) */
let usernamePrefillAttempted = false;

/** Track if 2FA state restoration has been attempted (only do it once on mount) */
let twoFactorStateRestoreAttempted = false;

/**
 * Login page
 */
const Login: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const app = useApp();
  const dbContext = useDb();
  const { setHeaderButtons } = useHeaderButtons();
  const [credentials, setCredentials] = useState({
    username: '',
    password: '',
  });
  const { showLoading, hideLoading, setIsInitialLoading } = useLoading();
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [clientUrl, setClientUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vaultError, setVaultError] = useState<VaultProcessingError | null>(null);
  const [showMobileLoginModal, setShowMobileLoginModal] = useState(false);
  const webApi = useWebApi();
  const finishBackgroundAuth = useFinishBackgroundAuth();

  /**
   * True while this page waits for a background login, so its own login does not trigger the cross-window reload.
   */
  const authInFlightRef = useRef(false);

  /**
   * Pull the vault from the server.
   */
  const pullAndLoadVault = async (): Promise<void> => {
    const result = await sendMessage('FULL_VAULT_SYNC', { forcePull: true, reportErrorToPopup: false });
    if (result.logoutReason === 'clientVersionNotSupported') {
      throw new ClientUpgradeRequiredError();
    }
    if (result.logoutReason === 'serverVersionNotSupported') {
      throw new ServerUpdateRequiredError();
    }
    if (!result.success) {
      throw new VaultProcessingError('vault-pull', new Error(syncErrorMessage(result, t) ?? t('common.errors.unknownError')));
    }

    await dbContext.loadStoredDatabase();
  };

  /**
   * Show login attempt failure.
   * @param context - what failed, for the console
   * @param err - the error
   */
  const showLoginError = async (context: string, err: unknown): Promise<void> => {
    logFailure(context, err);
    if (err instanceof VaultProcessingError) {
      // The vault was fetched but couldn't be decrypted/materialized, surface the real error (copyable) for support.
      setVaultError(err);
    } else {
      setError(formatErrorMessage(await describeAuthError(err), t));
    }
  };

  /**
   * Run a login flow in the background and show its outcome. Resolves to the outcome, or null when none ran.
   */
  const runBackgroundAuth = async (start: () => Promise<BackgroundAuthResult | null>): Promise<BackgroundAuthResult | null> => {
    authInFlightRef.current = true;
    let result: BackgroundAuthResult | null = null;
    try {
      result = await start();
      if (result) {
        await handleAuthResult(result);
      }
    } catch (err) {
      await showLoginError('Login error', err);
    } finally {
      // After a success the page navigates away, keep ignoring the unlock event until then.
      authInFlightRef.current = result?.status === 'success';
    }
    return result;
  };

  /**
   * Show the outcome of a background login flow.
   */
  const handleAuthResult = async (result: BackgroundAuthResult): Promise<void> => {
    switch (result.status) {
      case 'success': {
        // Reset prefill flag so next logout will prefill again
        usernamePrefillAttempted = false;
        setTwoFactorRequired(false);
        setTwoFactorCode('');
        const finishError = await finishBackgroundAuth(result.offline);
        if (finishError) {
          setError(finishError);
        }
        return;
      }
      case 'twoFactorRequired':
        setCredentials({ username: result.username, password: '' });
        setRememberMe(result.rememberMe);
        setTwoFactorRequired(true);
        return;
      case 'vaultPullFailed':
        // The vault was fetched but couldn't be decrypted/materialized, surface the real error (copyable) for support.
        setVaultError(new VaultProcessingError('vault-pull', new Error(syncErrorMessage(result.sync, t) ?? t('common.errors.unknownError'))));
        return;
      case 'logout':
        setError(result.message ?? t(result.reasonKey ?? 'common.errors.unknownError'));
        return;
      case 'error':
        setError(formatErrorMessage(result.error, t));
        return;
      default:
        // An unlock flow finished while this page was open, reinitialize routes to where it left the popup.
        navigate('/reinitialize', { replace: true });
    }
  };

  /**
   * Finish a mobile login: store the tokens and unlock key, then pull and load the vault.
   * @param username - the normalized username
   * @param token - the access token
   * @param refreshToken - the refresh token
   * @param unlockKey - the key the phone sent (its Account Key, or an unlock key from an older app), base64
   * @param derivationParams - how the unlock key is derived from the password
   */
  const handleSuccessfulAuth = async (
    username: string,
    token: string,
    refreshToken: string,
    unlockKey: string,
    derivationParams: UnlockKeyDerivationParams
  ) : Promise<void> => {
    // Store auth info first; the vault fetch below makes an authenticated request via the stored access token.
    await app.setAuthTokens(username, token, refreshToken);

    /*
     * Fetch the account's key chain, check the unlock key opens it and cache it as-is; the vault encryption key is
     * derived from the two on demand. Legacy accounts have no chain.
     */
    let accountKey: string;
    try {
      accountKey = await VaultKeyService.refreshKeyChain(unlockKey, webApi);
    } catch (err) {
      // If key chain can't be fetched, logout user and show error as this is not a recoverable error.
      await app.logout();
      throw err;
    }

    await dbContext.storeUnlockKeyDerivationParams({
      salt: derivationParams.salt,
      encryptionType: derivationParams.encryptionType,
      encryptionSettings: derivationParams.encryptionSettings
    });

    // Store the Account Key, then pull and load the vault.
    await dbContext.storeAccountKey(accountKey);
    await pullAndLoadVault();

    // Reset prefill flag so next logout will prefill again
    usernamePrefillAttempted = false;

    /*
     * Navigate to reinitialize page which will:
     * 1. Call syncVault() to check version compatibility
     * 2. Send the vault through /upgrade when either the legacy sqlite-blob chain or the manifest migration applies
     * 3. Navigate to appropriate page
     *
     * Other windows on /login or /unlock pick up the encryption-key storage
     * event via vaultStateEvents.onVaultUnlocked and reload themselves.
     */
    navigate('/reinitialize', { replace: true });

    // Show app.
    hideLoading();
  };

  useEffect(() => {
    /**
     * Load the client URL, check for saved username, and restore 2FA state if available.
     */
    const loadInitialData = async () : Promise<void> => {
      // Load client URL
      const settingClientUrl = await storage.getItem(StorageKeys.CLIENT_URL) as string;
      let clientUrl = AppInfo.DEFAULT_CLIENT_URL;
      if (settingClientUrl && settingClientUrl.length > 0) {
        clientUrl = settingClientUrl;
      }
      setClientUrl(clientUrl);

      // Pick up a login the background is still running because the popup was closed mid-login.
      const pending = await runBackgroundAuth(() => sendMessage('AUTH_AWAIT_PENDING'));
      if (pending) {
        twoFactorStateRestoreAttempted = true;
        setIsInitialLoading(false);
        return;
      }

      /*
       * Check for persisted 2FA state (from popup close during 2FA entry).
       * This allows users to close the popup to switch to their authenticator app
       * and continue where they left off when reopening.
       */
      if (!twoFactorStateRestoreAttempted) {
        twoFactorStateRestoreAttempted = true;
        const savedState = await sendMessage('GET_TWO_FACTOR_STATE');
        if (savedState) {
          // Restore the 2FA step, the background keeps what it needs to finish the login.
          setCredentials({ username: savedState.username, password: '' });
          setRememberMe(savedState.rememberMe);
          setTwoFactorRequired(true);
          setIsInitialLoading(false);
          return;
        }
      }

      /*
       * Check for saved username (from forced logout) and prefill once on mount
       * If user clears it, don't repopulate
       */
      if (!usernamePrefillAttempted) {
        usernamePrefillAttempted = true;
        const savedUsername = await storage.getItem(StorageKeys.USERNAME) as string | null;
        if (savedUsername) {
          setCredentials(prev => ({ ...prev, username: savedUsername }));
        }
      }

      setIsInitialLoading(false);
    };
    loadInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setIsInitialLoading]);

  // Set header buttons on mount and clear on unmount
  useEffect((): (() => void) => {
    const headerButtonsJSX = !PopoutUtility.isPopup() ? (
      <>
        <HeaderButton
          onClick={() => PopoutUtility.openInNewPopup()}
          title={t('common.openInNewWindow')}
          iconType={HeaderIconType.EXPAND}
        />
      </>
    ) : null;

    setHeaderButtons(headerButtonsJSX);

    return () => {
      setHeaderButtons(null);
    };
  }, [setHeaderButtons, t]);

  /*
   * Cross-window login sync: reload when another window unlocks/logs in.
   */
  useEffect(() => {
    return vaultStateEvents.onVaultUnlocked(() => {
      if (!authInFlightRef.current) {
        window.location.reload();
      }
    });
  }, []);

  /**
   * Handle submit
   */
  const handleSubmit = async (e: React.FormEvent) : Promise<void> => {
    e.preventDefault();
    setError(null);
    setVaultError(null);
    showLoading();

    // Clear global message if set with every login attempt.
    app.clearGlobalMessage();

    await runBackgroundAuth(() => sendMessage('AUTH_LOGIN', { username: credentials.username, password: credentials.password, rememberMe }));
    hideLoading();
  };

  /**
   * Handle two factor submit.
   */
  const handleTwoFactorSubmit = async (e: React.FormEvent) : Promise<void> => {
    e.preventDefault();
    setError(null);
    setVaultError(null);

    // Validate that 2FA code is a 6-digit number
    const code = twoFactorCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setError(t('common.errors.invalidCode'));
      return;
    }

    showLoading();
    await runBackgroundAuth(() => sendMessage('AUTH_LOGIN_TWO_FACTOR', { code }));
    hideLoading();
  };

  /**
   * Handle successful mobile login
   */
  const handleMobileLoginSuccess = async (result: MobileLoginResult): Promise<void> => {
    showLoading();
    try {
      // Clear global message if set
      app.clearGlobalMessage();
      setIsInitialLoading(false);

      // The mobile device sends the unlock key.
      await handleSuccessfulAuth(result.username, result.token, result.refreshToken, result.unlockKey, result);
    } catch (err) {
      await showLoginError('Mobile login error', err);
      hideLoading();
      throw err; // Re-throw to let modal show error
    }
  };

  /**
   * Handle change
   */
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) : void => {
    const { name, value } = e.target;
    setCredentials(prev => ({
      ...prev,
      [name]: value
    }));
  };

  if (twoFactorRequired) {
    return (
      <div className="flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md">
          <form onSubmit={handleTwoFactorSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{t('common.twoFactorAuthentication')}</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">{t('auth.twoFactorTitle')}</p>
            </div>

            {error && (
              <div className="mb-4 text-red-500 dark:text-red-400 text-sm">
                {error}
              </div>
            )}
            {vaultError && <VaultErrorReport error={vaultError} />}

            <div className="mb-6">
              <label className="block text-gray-700 dark:text-gray-200 font-medium mb-2" htmlFor="twoFactorCode">
                {t('auth.authCode')}
              </label>
              <input
                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 dark:text-gray-200 dark:bg-gray-700 dark:border-gray-600 leading-tight focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                id="twoFactorCode"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value)}
                placeholder={t('auth.enterAuthCode')}
                required
              />
            </div>
            <div className="flex flex-col w-full space-y-2">
              <Button type="submit">
                {t('auth.verify')}
              </Button>
              <Button
                type="button"
                onClick={async () => {
                  // Clear persisted 2FA state
                  await sendMessage('CLEAR_TWO_FACTOR_STATE');
                  // Reset the form
                  setCredentials({
                    username: '',
                    password: ''
                  });
                  setTwoFactorRequired(false);
                  setTwoFactorCode('');
                  setError(null);
                }}
                variant="secondary"
              >
                {t('common.cancel')}
              </Button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-6 text-center">
              {t('auth.authCodeNote')}
            </p>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          {/* Title */}
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">{t('auth.loginTitle')}</h2>
            <LoginServerInfo />
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 text-red-500 dark:text-red-400 text-sm">
              {error}
            </div>
          )}
          {vaultError && <VaultErrorReport error={vaultError} />}

          <div className="mb-4">
            <label className="block text-gray-700 dark:text-gray-200 font-medium mb-2" htmlFor="username">
              {t('auth.username')}
            </label>
            <input
              className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 dark:text-gray-200 dark:bg-gray-700 dark:border-gray-600 leading-tight focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              id="username"
              type="text"
              name="username"
              placeholder={t('auth.usernamePlaceholder')}
              value={credentials.username}
              onChange={handleChange}
              required
            />
          </div>
          <div className="mb-4">
            <label className="block text-gray-700 dark:text-gray-200 font-medium mb-2" htmlFor="password">
              {t('common.password')}
            </label>
            <div className="relative">
              <input
                className="shadow appearance-none border rounded-lg w-full py-2 px-3 pr-10 text-gray-700 dark:text-gray-200 dark:bg-gray-700 dark:border-gray-600 leading-tight focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                id="password"
                type={showPassword ? "text" : "password"}
                name="password"
                placeholder={t('auth.passwordPlaceholder')}
                value={credentials.password}
                onChange={handleChange}
                required
              />
              <button
                type="button"
                className="absolute right-2 top-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                <HeaderIcon type={showPassword ? HeaderIconType.EYE_OFF : HeaderIconType.EYE} className="w-5 h-5 text-gray-400 dark:text-gray-500" />
              </button>
            </div>
          </div>
          <div className="mb-6">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="mr-2"
              />
              <span className="text-sm text-gray-700 dark:text-gray-200">{t('auth.rememberMe')}</span>
            </label>
          </div>

          <Button type="submit">
            <div className="flex items-center justify-center gap-2">
              {t('auth.login')}
            </div>
          </Button>

          {/* Mobile Login Button */}
          <button
            type="button"
            onClick={() => setShowMobileLoginModal(true)}
            className="w-full max-w-md mt-4 px-4 py-2 text-sm font-medium text-center text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 focus:ring-4 focus:ring-gray-200 dark:bg-gray-600 dark:text-white dark:border-gray-500 dark:hover:bg-gray-500 dark:focus:ring-gray-700 flex items-center justify-center gap-2"
          >
            <Icon name="device-mobile" className="w-5 h-5" />
            {t('auth.loginWithMobile')}
          </button>

          <div className="text-center text-sm text-gray-500 dark:text-gray-400 mt-6">
            {t('auth.noAccountYet')}{' '}
            <a
              href={clientUrl ?? ''}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-500 hover:text-primary-600 dark:text-primary-400 dark:hover:text-primary-500"
            >
              {t('auth.createNewVault')}
            </a>
          </div>
        </form>

        {/* Mobile Login Modal */}
        <MobileUnlockModal
          isOpen={showMobileLoginModal}
          onClose={() => setShowMobileLoginModal(false)}
          onSuccess={handleMobileLoginSuccess}
          webApi={webApi}
          mode="login"
        />
      </div>
    </div>
  );
};

export default Login;
