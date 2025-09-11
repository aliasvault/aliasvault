import { Buffer } from 'buffer';

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import Button from '@/entrypoints/popup/components/Button';
import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import LoginServerInfo from '@/entrypoints/popup/components/LoginServerInfo';
import { useAuth } from '@/entrypoints/popup/context/AuthContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';
import ConversionUtility from '@/entrypoints/popup/utils/ConversionUtility';
import { PopoutUtility } from '@/entrypoints/popup/utils/PopoutUtility';
import SrpUtility from '@/entrypoints/popup/utils/SrpUtility';

import { AppInfo } from '@/utils/AppInfo';
import type { VaultResponse, LoginResponse } from '@/utils/dist/shared/models/webapi';
import EncryptionUtility from '@/utils/EncryptionUtility';
import { ApiAuthError } from '@/utils/types/errors/ApiAuthError';

import { storage } from '#imports';

/**
 * Login page
 */
const Login: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const authContext = useAuth();
  const dbContext = useDb();
  const { setHeaderButtons } = useHeaderButtons();
  const [credentials, setCredentials] = useState({
    username: '',
    password: '',
  });
  const { showLoading, hideLoading, setIsInitialLoading } = useLoading();
  const [rememberMe, setRememberMe] = useState(true);
  const [loginResponse, setLoginResponse] = useState<LoginResponse | null>(null);
  const [passwordHashString, setPasswordHashString] = useState<string | null>(null);
  const [passwordHashBase64, setPasswordHashBase64] = useState<string | null>(null);
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [clientUrl, setClientUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const webApi = useWebApi();
  const srpUtil = new SrpUtility(webApi);

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

    const vaultError = webApi.validateVaultResponse(vaultResponseJson, t);
    if (vaultError) {
      setError(vaultError);
      hideLoading();
      return;
    }

    // All is good. Store auth info which is required to make requests to the web API.
    await authContext.setAuthTokens(username, token, refreshToken);

    // Store the encryption key and derivation params separately
    await dbContext.storeEncryptionKey(passwordHashBase64);
    await dbContext.storeEncryptionKeyDerivationParams({
      salt: loginResponse.salt,
      encryptionType: loginResponse.encryptionType,
      encryptionSettings: loginResponse.encryptionSettings
    });

    // Initialize the SQLite context with the new vault data.
    const sqliteClient = await dbContext.initializeDatabase(vaultResponseJson, passwordHashBase64);

    // Set logged in status to true which refreshes the app.
    await authContext.login();

    // If there are pending migrations, redirect to the upgrade page.
    try {
      if (await sqliteClient.hasPendingMigrations()) {
        navigate('/upgrade', { replace: true });
        hideLoading();
        return;
      }
    } catch (err) {
      await authContext.logout();
      setError(err instanceof Error ? err.message : t('auth.errors.migrationError'));
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
      authContext.clearGlobalMessage();

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
        throw new Error(t('auth.errors.noToken'));
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
        throw new Error(t('auth.errors.loginDataMissing'));
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
        throw new Error(t('auth.errors.noToken'));
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
              {t('auth.cancel')}
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
    <div>
      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-700 w-full shadow-md rounded px-8 pt-6 pb-8 mb-4">
        {error && (
          <div className="mb-4 text-red-500 dark:text-red-400 text-sm">
            {error}
          </div>
        )}
        <h2 className="text-xl font-bold dark:text-gray-200">{t('auth.loginTitle')}</h2>
        <LoginServerInfo />
        <div className="mb-4">
          <label className="block text-gray-700 dark:text-gray-200 text-sm font-bold mb-2" htmlFor="username">
            {t('auth.username')}
          </label>
          <input
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 dark:text-gray-200 dark:bg-gray-800 dark:border-gray-600 leading-tight focus:outline-none focus:shadow-outline"
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
          <label className="block text-gray-700 dark:text-gray-200 text-sm font-bold mb-2" htmlFor="password">
            {t('auth.password')}
          </label>
          <input
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 dark:text-gray-200 dark:bg-gray-800 dark:border-gray-600 mb-3 leading-tight focus:outline-none focus:shadow-outline"
            id="password"
            type="password"
            name="password"
            placeholder={t('auth.passwordPlaceholder')}
            value={credentials.password}
            onChange={handleChange}
            required
          />
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
        <div className="flex w-full">
          <Button type="submit">
            {t('auth.loginButton')}
          </Button>
        </div>
      </form>
      <div className="text-center text-sm text-gray-600 dark:text-gray-400">
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
    </div>
  );
};

export default Login;
