import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import Button from '@/entrypoints/popup/components/Button';
import MobileUnlockModal from '@/entrypoints/popup/components/Dialogs/MobileUnlockModal';
import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIcon, HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import LoginServerInfo from '@/entrypoints/popup/components/LoginServerInfo';
import VaultErrorReport from '@/entrypoints/popup/components/VaultErrorReport';
import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';
import { PopoutUtility } from '@/entrypoints/popup/utils/PopoutUtility';
import SrpUtility from '@/entrypoints/popup/utils/SrpUtility';

import { AppInfo } from '@/utils/AppInfo';
import { SrpAuthService } from '@/utils/auth/SrpAuthService';
import type { VaultResponse, LoginResponse } from '@/utils/dist/core/models/webapi';
import { EncryptionUtility } from '@/utils/EncryptionUtility';
import { sendMessage } from '@/utils/messaging/ExtensionMessaging';
import { ApiAuthError } from '@/utils/types/errors/ApiAuthError';
import { hasErrorCode, getErrorMessage } from '@/utils/types/errors/AppErrorCodes';
import { ServerUpdateRequiredError } from '@/utils/types/errors/ServerUpdateRequiredError';
import { VaultProcessingError } from '@/utils/types/errors/VaultProcessingError';
import type { MobileLoginResult } from '@/utils/types/messaging/MobileLoginResult';
import { VaultKeyService } from '@/utils/VaultKeyService';
import { vaultSyncService } from '@/utils/VaultSyncService';

import { vaultStateEvents } from '@/events/VaultStateEvents';

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
  const [loginResponse, setLoginResponse] = useState<LoginResponse | null>(null);
  const [passwordHashString, setPasswordHashString] = useState<string | null>(null);
  const [passwordHashBase64, setPasswordHashBase64] = useState<string | null>(null);
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [clientUrl, setClientUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vaultError, setVaultError] = useState<VaultProcessingError | null>(null);
  const [showMobileLoginModal, setShowMobileLoginModal] = useState(false);
  const webApi = useWebApi();
  const srpUtil = new SrpUtility(webApi);

  /**
   * Helper to persist and load vault after successful authentication.
   * Checks if local vault exists from forced logout and preserves it if more advanced.
   * Also checks if the vault belongs to the same user - if different user, uses server vault.
   */
  const persistAndLoadVault = async (vaultResponse: VaultResponse, encryptionKey: string, loginUsername: string): Promise<void> => {
    // Check if there's existing vault data (from forced logout)
    const existingVault = await storage.getItem('local:encryptedVault') as string | null;
    const existingRevision = await storage.getItem('local:serverRevision') as number | null;
    const storedUsername = await storage.getItem('local:username') as string | null;

    let vaultToLoad = vaultResponse.vault.blob;

    if (existingVault && existingRevision !== null) {
      // Check if the existing vault belongs to a different user
      const normalizedLoginUsername = loginUsername.toLowerCase().trim();
      const normalizedStoredUsername = storedUsername?.toLowerCase().trim();

      if (storedUsername && normalizedStoredUsername !== normalizedLoginUsername) {
        // Different user
        console.info(
          `Existing vault belongs to different user (${storedUsername}), using server vault for ${loginUsername}`
        );
      } else {
        // Same user (or no stored username)
        try {
          const decryptedExisting = await EncryptionUtility.symmetricDecrypt(existingVault, encryptionKey);

          // Check if existing vault is more advanced than server
          if (existingRevision >= vaultResponse.vault.currentRevisionNumber) {
            console.info(
              `Existing vault is more advanced (rev ${existingRevision} >= ${vaultResponse.vault.currentRevisionNumber}), ` +
              `preserving local vault and will upload to server`
            );

            // Update metadata and load existing vault
            vaultToLoad = existingVault;
            await sendMessage('STORE_VAULT_METADATA', {
              publicEmailDomainList: vaultResponse.vault.publicEmailDomainList,
              privateEmailDomainList: vaultResponse.vault.privateEmailDomainList,
              hiddenPrivateEmailDomainList: vaultResponse.vault.hiddenPrivateEmailDomainList,
            });

            await dbContext.loadDatabase(decryptedExisting);
            return;
          }

          // Server is more advanced, fetch server vault
          console.info(
            `Server vault is more advanced (rev ${vaultResponse.vault.currentRevisionNumber} > ${existingRevision}), ` +
            `using server vault`
          );
        } catch {
          // Decryption failed, password changed or corrupt vault
          console.info('Existing vault could not be decrypted (password changed), using server vault');
        }
      }
    }

    // Normal flow: persist server vault to local storage
    await sendMessage('STORE_ENCRYPTED_VAULT', {
      vaultBlob: vaultResponse.vault.blob,
      serverRevision: vaultResponse.vault.currentRevisionNumber,
    });

    await sendMessage('STORE_VAULT_METADATA', {
      publicEmailDomainList: vaultResponse.vault.publicEmailDomainList,
      privateEmailDomainList: vaultResponse.vault.privateEmailDomainList,
      hiddenPrivateEmailDomainList: vaultResponse.vault.hiddenPrivateEmailDomainList,
    });

    // Decrypt and load the vault into memory
    const decryptedVault = await EncryptionUtility.symmetricDecrypt(vaultToLoad, encryptionKey);
    await dbContext.loadDatabase(decryptedVault);
  };

  /**
   * Handle successful authentication by storing tokens and initializing the database
   */
  const handleSuccessfulAuth = async (
    username: string,
    token: string,
    refreshToken: string,
    passwordHashBase64: string,
    loginResponse: LoginResponse
  ) : Promise<void> => {
    // Store auth info first — the vault fetch below makes an authenticated request via the stored access token.
    await app.setAuthTokens(username, token, refreshToken);

    /*
     * KEK/VEK: for migrated accounts the derived key is only the KEK; fetch the vault key and unwrap the VEK,
     * which becomes the session encryption key. Legacy accounts keep using the derived key directly.
     */
    const { encryptionKey } = await VaultKeyService.resolveEncryptionKey(passwordHashBase64, webApi);

    // Store the encryption key and derivation params separately
    await dbContext.storeEncryptionKey(encryptionKey);
    await dbContext.storeEncryptionKeyDerivationParams({
      salt: loginResponse.salt,
      encryptionType: loginResponse.encryptionType,
      encryptionSettings: loginResponse.encryptionSettings
    });

    // Fetch the latest vault.
    const vaultResponseJson = await vaultSyncService.pull(encryptionKey);

    /*
     * Persist and load the vault.
     * If there was a forced logout, persistAndLoadVault checks existing vault data:
     * - If different user > uses server vault
     * - If local vault is more advanced > preserves it (will upload via sync in /reinitialize)
     * - If server is more advanced > uses server vault
     * - If password changed (can't decrypt) > uses server vault
     */
    await persistAndLoadVault(vaultResponseJson, encryptionKey, username);

    // Reset prefill flag so next logout will prefill again
    usernamePrefillAttempted = false;

    /*
     * Navigate to reinitialize page which will:
     * 1. Call syncVault() to check version compatibility
     * 2. Handle pending migrations via onUpgradeRequired callback
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
      const settingClientUrl = await storage.getItem('local:clientUrl') as string;
      let clientUrl = AppInfo.DEFAULT_CLIENT_URL;
      if (settingClientUrl && settingClientUrl.length > 0) {
        clientUrl = settingClientUrl;
      }
      setClientUrl(clientUrl);

      /*
       * Check for persisted 2FA state (from popup close during 2FA entry).
       * This allows users to close the popup to switch to their authenticator app
       * and continue where they left off when reopening.
       */
      if (!twoFactorStateRestoreAttempted) {
        twoFactorStateRestoreAttempted = true;
        const savedState = await sendMessage('GET_TWO_FACTOR_STATE');
        if (savedState) {
          // Restore the 2FA state
          setCredentials({ username: savedState.username, password: '' });
          setLoginResponse(savedState.loginResponse);
          setPasswordHashString(savedState.passwordHashString);
          setPasswordHashBase64(savedState.passwordHashBase64);
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
        const savedUsername = await storage.getItem('local:username') as string | null;
        if (savedUsername) {
          setCredentials(prev => ({ ...prev, username: savedUsername }));
        }
      }

      setIsInitialLoading(false);
    };
    loadInitialData();
  }, [setIsInitialLoading]);

  // Set header buttons on mount and clear on unmount
  useEffect((): (() => void) => {
    const headerButtonsJSX = !PopoutUtility.isPopup() ? (
      <>
        <HeaderButton
          onClick={() => PopoutUtility.openInNewPopup()}
          title="Open in new window"
          iconType={HeaderIconType.EXPAND}
        />
      </>
    ) : null;

    setHeaderButtons(headerButtonsJSX);

    return () => {
      setHeaderButtons(null);
    };
  }, [setHeaderButtons]);

  /*
   * Cross-window login sync: reload when another window unlocks/logs in.
   */
  useEffect(() => {
    return vaultStateEvents.onVaultUnlocked(() => {
      window.location.reload();
    });
  }, []);

  /**
   * Handle submit
   */
  const handleSubmit = async (e: React.FormEvent) : Promise<void> => {
    e.preventDefault();
    setError(null);
    setVaultError(null);

    try {
      showLoading();

      // Clear global message if set with every login attempt.
      app.clearGlobalMessage();

      // Initiate login with server
      const normalizedUsername = SrpAuthService.normalizeUsername(credentials.username);
      const loginResponse = await srpUtil.initiateLogin(normalizedUsername);

      // Derive key from password using Argon2id and prepare credentials
      const { passwordHashString, passwordHashBase64 } = await SrpAuthService.prepareCredentials(
        credentials.password,
        loginResponse.salt,
        loginResponse.encryptionType,
        loginResponse.encryptionSettings
      );

      // Validate login with SRP protocol
      const validationResponse = await srpUtil.validateLogin(
        normalizedUsername,
        passwordHashString,
        rememberMe,
        loginResponse
      );

      // Handle 2FA if required
      if (validationResponse.requiresTwoFactor) {
        // Store login response as we need it for 2FA validation
        setLoginResponse(loginResponse);
        // Store password hash string as we need it for 2FA validation
        setPasswordHashString(passwordHashString);
        // Store password hash base64 as we need it for decryption
        setPasswordHashBase64(passwordHashBase64);
        setTwoFactorRequired(true);

        /*
         * Persist 2FA state to background script so user can
         * close popup to switch to authenticator app and continue when reopening
         */
        await sendMessage('STORE_TWO_FACTOR_STATE', {
          username: normalizedUsername,
          loginResponse,
          passwordHashString,
          passwordHashBase64,
          rememberMe,
        });

        // Show app.
        hideLoading();
        return;
      }

      // Check if token was returned.
      if (!validationResponse.token) {
        throw new Error(t('common.errors.unknownError'));
      }

      // Handle successful authentication
      await handleSuccessfulAuth(
        normalizedUsername,
        validationResponse.token.token,
        validationResponse.token.refreshToken,
        passwordHashBase64,
        loginResponse
      );
    } catch (err) {
      console.error('Login error:', err);
      if (err instanceof ServerUpdateRequiredError) {
        // Server does not support the v2 API, throw unsupported error.
        setError(t('common.errors.serverVersionNotSupported'));
      } else if (err instanceof VaultProcessingError) {
        // The vault was fetched but couldn't be decrypted/materialized, surface the real error (copyable) for support.
        setVaultError(err);
      } else if (err instanceof ApiAuthError) {
        // Show API authentication errors as-is.
        setError(t('common.apiErrors.' + err.message));
      } else if (hasErrorCode(err)) {
        // Error contains an error code (E-XXX), show the formatted message.
        setError(getErrorMessage(err, t('common.errors.serverError')));
      } else {
        setError(t('common.errors.serverError'));
      }
      hideLoading();
    }
  };

  /**
   * Handle two factor submit.
   */
  const handleTwoFactorSubmit = async (e: React.FormEvent) : Promise<void> => {
    e.preventDefault();
    setError(null);
    setVaultError(null);

    try {
      showLoading();

      if (!passwordHashString || !passwordHashBase64 || !loginResponse) {
        throw new Error(t('common.errors.unknownError'));
      }

      // Validate that 2FA code is a 6-digit number
      const code = twoFactorCode.trim();
      if (!/^\d{6}$/.test(code)) {
        throw new Error(t('common.errors.invalidCode'));
      }

      const twoFaUsername = SrpAuthService.normalizeUsername(credentials.username);
      const validationResponse = await srpUtil.validateLogin2Fa(
        twoFaUsername,
        passwordHashString,
        rememberMe,
        loginResponse,
        parseInt(twoFactorCode)
      );

      // Check if token was returned.
      if (!validationResponse.token) {
        throw new Error(t('common.errors.unknownError'));
      }

      // Clear any persisted 2FA state since login is successful
      await sendMessage('CLEAR_TWO_FACTOR_STATE');

      // Handle successful authentication
      await handleSuccessfulAuth(
        twoFaUsername,
        validationResponse.token.token,
        validationResponse.token.refreshToken,
        passwordHashBase64,
        loginResponse
      );

      // Reset 2FA state and login response as it's no longer needed
      setTwoFactorRequired(false);
      setTwoFactorCode('');
      setPasswordHashString(null);
      setPasswordHashBase64(null);
      setLoginResponse(null);
    } catch (err) {
      // Show API authentication errors as-is.
      console.error('2FA error:', err);
      if (err instanceof ServerUpdateRequiredError) {
        // Server does not support the v2 API, throw unsupported error.
        setError(t('common.errors.serverVersionNotSupported'));
      } else if (err instanceof VaultProcessingError) {
        // The vault was fetched but couldn't be decrypted/materialized, surface the real error (copyable) for support.
        setVaultError(err);
      } else if (err instanceof ApiAuthError) {
        setError(t('common.apiErrors.' + err.message));
      } else if (hasErrorCode(err)) {
        // Error contains an error code (E-XXX), show the formatted message.
        setError(getErrorMessage(err, t('common.errors.serverError')));
      } else {
        setError(t('common.errors.serverError'));
      }
      hideLoading();
    }
  };

  /**
   * Handle successful mobile login
   */
  const handleMobileLoginSuccess = async (result: MobileLoginResult): Promise<void> => {
    showLoading();
    try {
      // Clear global message if set
      app.clearGlobalMessage();

      // Store auth tokens and username first — the vault fetch below uses the stored access token.
      await app.setAuthTokens(result.username, result.token, result.refreshToken);

      /*
       * The mobile device sends the vault encryption key (the VEK for migrated accounts, or the derived key when
       * the mobile app predates the KEK/VEK model). Refresh the local wrapped-VEK cache so offline password unlock
       * keeps working, then upgrade the received key to the VEK when it turns out to be the KEK.
       */
      await VaultKeyService.cacheWrappedVekFromServer(webApi);
      const mobileKey = await VaultKeyService.resolveStoredUnlockKey(result.decryptionKey);

      // Store the encryption key and derivation params
      await dbContext.storeEncryptionKey(mobileKey);
      await dbContext.storeEncryptionKeyDerivationParams({
        salt: result.salt,
        encryptionType: result.encryptionType,
        encryptionSettings: result.encryptionSettings,
      });

      // Fetch the latest vault.
      const vaultResponse = await vaultSyncService.pull(mobileKey);

      // Persist and load the vault
      await persistAndLoadVault(vaultResponse, mobileKey, result.username);

      /*
       * Navigate to reinitialize page which will:
       * 1. Call syncVault() to check version compatibility
       * 2. Handle pending migrations via onUpgradeRequired callback
       * 3. Navigate to appropriate page
       */
      hideLoading();
      setIsInitialLoading(false);
      navigate('/reinitialize', { replace: true });
    } catch (err) {
      if (err instanceof ServerUpdateRequiredError) {
        // Server does not support the v2 API, throw unsupported error.
        setError(t('common.errors.serverVersionNotSupported'));
      } else {
        setError(err instanceof Error ? err.message : t('common.errors.unknownError'));
      }
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
      <div>
        <form onSubmit={handleTwoFactorSubmit} className="bg-white dark:bg-gray-700 w-full shadow-md rounded px-8 pt-6 pb-8 mb-4">
          {error && (
            <div className="mb-4 text-red-500 dark:text-red-400 text-sm">
              {error}
            </div>
          )}
          {vaultError && <VaultErrorReport error={vaultError} />}
          <div className="mb-6">
            <p className="text-gray-700 dark:text-gray-200 mb-4">
              {t('auth.twoFactorTitle')}
            </p>
            <label className="block text-gray-700 dark:text-gray-200 text-sm font-bold mb-2" htmlFor="twoFactorCode">
              {t('auth.authCode')}
            </label>
            <input
              className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 dark:text-gray-200 dark:bg-gray-800 dark:border-gray-600 leading-tight focus:outline-none focus:shadow-outline"
              id="twoFactorCode"
              type="text"
              value={twoFactorCode}
              onChange={(e) => setTwoFactorCode(e.target.value)}
              placeholder={t('auth.authCodePlaceholder')}
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
                setPasswordHashString(null);
                setPasswordHashBase64(null);
                setLoginResponse(null);
                setError(null);
              }}
              variant="secondary"
            >
              {t('common.cancel')}
            </Button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-4 text-center">
            {t('auth.twoFactorNote')}
          </p>
        </form>
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
              {t('auth.loginButton')}
            </div>
          </Button>

          {/* Mobile Login Button */}
          <button
            type="button"
            onClick={() => setShowMobileLoginModal(true)}
            className="w-full max-w-md mt-4 px-4 py-2 text-sm font-medium text-center text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 focus:ring-4 focus:ring-gray-200 dark:bg-gray-600 dark:text-white dark:border-gray-500 dark:hover:bg-gray-500 dark:focus:ring-gray-700 flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
            </svg>
            {t('auth.loginWithMobile')}
          </button>

          <div className="text-center text-sm text-gray-500 dark:text-gray-400 mt-6">
            {t('auth.noAccount')}{' '}
            <a
              href={clientUrl ?? ''}
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-500"
            >
              {t('auth.createVault')}
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
