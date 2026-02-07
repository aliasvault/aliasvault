import { Buffer } from 'buffer';

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import Button from '@/entrypoints/popup/components/Button';
import MobileUnlockModal from '@/entrypoints/popup/components/Dialogs/MobileUnlockModal';
import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIcon, HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import LoginServerInfo from '@/entrypoints/popup/components/LoginServerInfo';
import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';
import ConversionUtility from '@/entrypoints/popup/utils/ConversionUtility';
import { PopoutUtility } from '@/entrypoints/popup/utils/PopoutUtility';
import SrpUtility from '@/entrypoints/popup/utils/SrpUtility';
import { useWallet } from '@/entrypoints/popup/context/WalletContext';

import { AppInfo } from '@/utils/AppInfo';
import type { VaultResponse, LoginResponse } from '@/utils/dist/shared/models/webapi';
import EncryptionUtility from '@/utils/EncryptionUtility';
import { ApiAuthError } from '@/utils/types/errors/ApiAuthError';
import type { MobileLoginResult } from '@/utils/types/messaging/MobileLoginResult';

import { storage } from '#imports';

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
  const [showMobileLoginModal, setShowMobileLoginModal] = useState(false);
  const webApi = useWebApi();
  const srpUtil = new SrpUtility(webApi);
  const wallet = useWallet();

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
    // Try to get latest vault manually providing auth token.
    const vaultResponseJson = await webApi.authFetch<VaultResponse>('Vault', { method: 'GET', headers: {
      'Authorization': `Bearer ${token}`
    } });

    // All is good. Store auth info which is required to make requests to the web API.
    await app.setAuthTokens(username, token, refreshToken);

    // Store the encryption key and derivation params separately
    await dbContext.storeEncryptionKey(passwordHashBase64);
    await dbContext.storeEncryptionKeyDerivationParams({
      salt: loginResponse.salt,
      encryptionType: loginResponse.encryptionType,
      encryptionSettings: loginResponse.encryptionSettings
    });

    // Initialize the SQLite context with the new vault data.
    const sqliteClient = await dbContext.initializeDatabase(vaultResponseJson, passwordHashBase64);

    // If there are pending migrations, redirect to the upgrade page.
    try {
      if (await sqliteClient.hasPendingMigrations()) {
        navigate('/upgrade', { replace: true });
        hideLoading();
        return;
      }
    } catch (err) {
      await app.logout();
      setError(err instanceof Error ? err.message : t('common.errors.unknownError'));
      hideLoading();
      return;
    }

    // Navigate to reinitialize page which will take care of the proper redirect.
    navigate('/reinitialize', { replace: true });

    // Show app.
    hideLoading();
  };

  useEffect(() => {
    /**
     * Load the client URL from the storage.
     */
    const loadClientUrl = async () : Promise<void> => {
      const settingClientUrl = await storage.getItem('local:clientUrl') as string;
      let clientUrl = AppInfo.DEFAULT_CLIENT_URL;
      if (settingClientUrl && settingClientUrl.length > 0) {
        clientUrl = settingClientUrl;
      }

      setClientUrl(clientUrl);
      setIsInitialLoading(false);
    };
    loadClientUrl();
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

  /**
   * Handle submit
   */
  const handleSubmit = async (e: React.FormEvent) : Promise<void> => {
    e.preventDefault();
    setError(null);

    try {
      showLoading();

      // Clear global message if set with every login attempt.
      app.clearGlobalMessage();

      // Use the srpUtil instance instead of the imported singleton
      const loginResponse = await srpUtil.initiateLogin(ConversionUtility.normalizeUsername(credentials.username));

      // 1. Derive key from password using Argon2id
      const passwordHash = await EncryptionUtility.deriveKeyFromPassword(
        credentials.password,
        loginResponse.salt,
        loginResponse.encryptionType,
        loginResponse.encryptionSettings
      );

      // Convert uint8 array to uppercase hex string which is expected by the server.
      const passwordHashString = Buffer.from(passwordHash).toString('hex').toUpperCase();

      // Get the derived key as base64 string required for decryption.
      const passwordHashBase64 = Buffer.from(passwordHash).toString('base64');

      // 2. Validate login with SRP protocol
      const validationResponse = await srpUtil.validateLogin(
        ConversionUtility.normalizeUsername(credentials.username),
        passwordHashString,
        rememberMe,
        loginResponse
      );

      // 3. Handle 2FA if required
      if (validationResponse.requiresTwoFactor) {
        // Store login response as we need it for 2FA validation
        setLoginResponse(loginResponse);
        // Store password hash string as we need it for 2FA validation
        setPasswordHashString(passwordHashString);
        // Store password hash base64 as we need it for decryption
        setPasswordHashBase64(passwordHashBase64);
        setTwoFactorRequired(true);
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
        ConversionUtility.normalizeUsername(credentials.username),
        validationResponse.token.token,
        validationResponse.token.refreshToken,
        passwordHashBase64,
        loginResponse
      );
    } catch (err) {
      // Show API authentication errors as-is.
      if (err instanceof ApiAuthError) {
        setError(t('common.apiErrors.' + err.message));
      } else {
        setError(t('auth.errors.serverError'));
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

    try {
      showLoading();

      if (!passwordHashString || !passwordHashBase64 || !loginResponse) {
        throw new Error(t('common.errors.unknownError'));
      }

      // Validate that 2FA code is a 6-digit number
      const code = twoFactorCode.trim();
      if (!/^\d{6}$/.test(code)) {
        throw new Error(t('auth.errors.invalidCode'));
      }

      const validationResponse = await srpUtil.validateLogin2Fa(
        ConversionUtility.normalizeUsername(credentials.username),
        passwordHashString,
        rememberMe,
        loginResponse,
        parseInt(twoFactorCode)
      );

      // Check if token was returned.
      if (!validationResponse.token) {
        throw new Error(t('common.errors.unknownError'));
      }

      // Handle successful authentication
      await handleSuccessfulAuth(
        ConversionUtility.normalizeUsername(credentials.username),
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
      if (err instanceof ApiAuthError) {
        setError(t('common.apiErrors.' + err.message));
      } else {
        setError(t('auth.errors.serverError'));
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

      // Fetch vault from server with the new auth token
      const vaultResponse = await webApi.authFetch<VaultResponse>('Vault', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${result.token}`,
        },
      });

      // Store auth tokens and username
      await app.setAuthTokens(result.username, result.token, result.refreshToken);

      // Store the encryption key and derivation params
      await dbContext.storeEncryptionKey(result.decryptionKey);
      await dbContext.storeEncryptionKeyDerivationParams({
        salt: result.salt,
        encryptionType: result.encryptionType,
        encryptionSettings: result.encryptionSettings,
      });

      // Initialize the database with the vault data
      const sqliteClient = await dbContext.initializeDatabase(vaultResponse, result.decryptionKey);

      // Check for pending migrations
      try {
        if (await sqliteClient.hasPendingMigrations()) {
          navigate('/upgrade', { replace: true });
          hideLoading();
          setIsInitialLoading(false);
          return;
        }
      } catch (err) {
        await app.logout();
        setError(err instanceof Error ? err.message : t('common.errors.unknownError'));
        hideLoading();
        return;
      }

      // Navigate to reinitialize page
      hideLoading();
      setIsInitialLoading(false);
      navigate('/reinitialize', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errors.unknownError'));
      hideLoading();
      throw err; // Re-throw to let modal show error
    }
  };

  /**
   * Handle Lace wallet connection
   */
  const handleWalletConnect = async () : Promise<void> => {
    await wallet.connectWallet();
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
              onClick={() => {
                // Reset the form.
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
              {t('auth.password')}
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

          {/* Divider */}
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300 dark:border-gray-600"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                {t('wallet.orConnectWallet')}
              </span>
            </div>
          </div>

          {/* Lace Wallet Connection + Signature Challenge */}
          {wallet.isConnected && wallet.walletState && wallet.isVerified ? (
            /* State 3: Wallet connected AND signature verified */
            <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
                  </svg>
                  <span className="text-sm font-medium text-green-700 dark:text-green-400">
                    {t('wallet.verified')}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => wallet.disconnectWallet()}
                  className="text-xs text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400"
                >
                  {t('wallet.disconnect')}
                </button>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-300 font-mono break-all">
                {wallet.walletState.address.slice(0, 20)}...{wallet.walletState.address.slice(-12)}
              </p>
            </div>
          ) : wallet.isConnected && wallet.walletState ? (
            /* State 2: Wallet connected, needs signature challenge */
            <div className="space-y-2">
              <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                    <span className="text-sm font-medium text-blue-700 dark:text-blue-400">
                      {t('wallet.connected')}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => wallet.disconnectWallet()}
                    className="text-xs text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400"
                  >
                    {t('wallet.disconnect')}
                  </button>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-300 font-mono break-all">
                  {wallet.walletState.address.slice(0, 20)}...{wallet.walletState.address.slice(-12)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => wallet.signChallenge()}
                disabled={wallet.isSigning}
                className="w-full px-4 py-2.5 text-sm font-medium text-center text-white bg-green-600 border border-green-600 rounded-lg hover:bg-green-700 focus:ring-4 focus:ring-green-200 dark:bg-green-700 dark:border-green-700 dark:hover:bg-green-600 dark:focus:ring-green-800 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path>
                </svg>
                {wallet.isSigning ? t('wallet.signing') : t('wallet.signChallenge')}
              </button>
            </div>
          ) : (
            /* State 1: Not connected */
            <button
              type="button"
              onClick={handleWalletConnect}
              disabled={wallet.isConnecting}
              className="w-full px-4 py-2.5 text-sm font-medium text-center text-white bg-purple-600 border border-purple-600 rounded-lg hover:bg-purple-700 focus:ring-4 focus:ring-purple-200 dark:bg-purple-700 dark:border-purple-700 dark:hover:bg-purple-600 dark:focus:ring-purple-800 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"></path>
              </svg>
              {wallet.isConnecting ? t('wallet.connecting') : t('wallet.connectLace')}
            </button>
          )}

          {/* Wallet Error */}
          {wallet.error && (
            <p className="mt-2 text-xs text-red-500 dark:text-red-400 text-center">
              {wallet.error}
            </p>
          )}

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
