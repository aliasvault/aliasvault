import React, { useEffect, useState } from 'react';
import { Buffer } from 'buffer';
import { storage } from '#imports';
import { useAuth } from '@/entrypoints/popup/context/AuthContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';
import { AppInfo } from '@/utils/AppInfo';
import Button from '@/entrypoints/popup/components/Button';
import EncryptionUtility from '@/utils/EncryptionUtility';
import SrpUtility from '@/entrypoints/popup/utils/SrpUtility';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { VaultResponse } from '@/utils/types/webapi/VaultResponse';
import { LoginResponse } from '@/utils/types/webapi/Login';
import LoginServerInfo from '@/entrypoints/popup/components/LoginServerInfo';
import { ApiAuthError } from '@/utils/types/errors/ApiAuthError';
import ConversionUtility from '../utils/ConversionUtility';

/**
 * Login page
 */
const Login: React.FC = () => {
  const authContext = useAuth();
  const dbContext = useDb();
  const [credentials, setCredentials] = useState({
    username: '',
    password: '',
  });
  const { showLoading, hideLoading } = useLoading();
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
    };
    loadClientUrl();
  }, []);

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
        throw new Error('Login failed -- no token returned');
      }

      // Try to get latest vault manually providing auth token.
      const vaultResponseJson = await webApi.authFetch<VaultResponse>('Vault', { method: 'GET', headers: {
        'Authorization': `Bearer ${validationResponse.token.token}`
      } });

      const vaultError = webApi.validateVaultResponse(vaultResponseJson);
      if (vaultError) {
        setError(vaultError);
        hideLoading();
        return;
      }

      // All is good. Store auth info which is required to make requests to the web API.
      await authContext.setAuthTokens(ConversionUtility.normalizeUsername(credentials.username), validationResponse.token.token, validationResponse.token.refreshToken);

      // Initialize the SQLite context with the new vault data.
      await dbContext.initializeDatabase(vaultResponseJson, passwordHashBase64);

      // Set logged in status to true which refreshes the app.
      await authContext.login();

      // Show app.
      hideLoading();
    } catch (err) {
      // Show API authentication errors as-is.
      if (err instanceof ApiAuthError) {
        setError(err.message);
      } else {
        setError('Could not reach AliasVault server. Please try again later or contact support if the problem persists.');
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
        throw new Error('Required login data not found');
      }

      // Validate that 2FA code is a 6-digit number
      const code = twoFactorCode.trim();
      if (!/^\d{6}$/.test(code)) {
        throw new ApiAuthError('Please enter a valid 6-digit authentication code.');
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
        throw new Error('Login failed -- no token returned');
      }

      // Try to get latest vault manually providing auth token.
      const vaultResponseJson = await webApi.authFetch<VaultResponse>('Vault', { method: 'GET', headers: {
        'Authorization': `Bearer ${validationResponse.token.token}`
      } });

      const vaultError = webApi.validateVaultResponse(vaultResponseJson);
      if (vaultError) {
        setError(vaultError);
        hideLoading();
        return;
      }

      // All is good. Store auth info which is required to make requests to the web API.
      await authContext.setAuthTokens(ConversionUtility.normalizeUsername(credentials.username), validationResponse.token.token, validationResponse.token.refreshToken);

      // Initialize the SQLite context with the new vault data.
      await dbContext.initializeDatabase(vaultResponseJson, passwordHashBase64);

      // Set logged in status to true which refreshes the app.
      await authContext.login();

      // Reset 2FA state and login response as it's no longer needed
      setTwoFactorRequired(false);
      setTwoFactorCode('');
      setPasswordHashString(null);
      setPasswordHashBase64(null);
      setLoginResponse(null);
      hideLoading();
    } catch (err) {
      // Show API authentication errors as-is.
      console.error('2FA error:', err);
      if (err instanceof ApiAuthError) {
        setError(err.message);
      } else {
        setError('Could not reach AliasVault server. Please try again later or contact support if the problem persists.');
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
      <div className="max-w-md">
        <form onSubmit={handleTwoFactorSubmit} className="bg-white dark:bg-gray-700 w-full shadow-md rounded px-8 pt-6 pb-8 mb-4">
          {error && (
            <div className="mb-4 text-red-500 dark:text-red-400 text-sm">
              {error}
            </div>
          )}
          <div className="mb-6">
            <p className="text-gray-700 dark:text-gray-200 mb-4">
              Please enter the authentication code from your authenticator app.
            </p>
            <label className="block text-gray-700 dark:text-gray-200 text-sm font-bold mb-2" htmlFor="twoFactorCode">
              Authentication Code
            </label>
            <input
              className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 dark:text-gray-200 dark:bg-gray-800 dark:border-gray-600 leading-tight focus:outline-none focus:shadow-outline"
              id="twoFactorCode"
              type="text"
              value={twoFactorCode}
              onChange={(e) => setTwoFactorCode(e.target.value)}
              placeholder="Enter 6-digit code"
              required
            />
          </div>
          <div className="flex flex-col w-full space-y-2">
            <Button type="submit">
              Verify
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
              Cancel
            </Button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-4 text-center">
            Note: if you don&apos;t have access to your authenticator device, you can reset your 2FA with a recovery code by logging in via the website.
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-md">
      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-700 w-full shadow-md rounded px-8 pt-6 pb-8 mb-4">
        {error && (
          <div className="mb-4 text-red-500 dark:text-red-400 text-sm">
            {error}
          </div>
        )}
        <h2 className="text-xl font-bold dark:text-gray-200">Log in to AliasVault</h2>
        <LoginServerInfo />
        <div className="mb-4">
          <label className="block text-gray-700 dark:text-gray-200 text-sm font-bold mb-2" htmlFor="username">
            Username or email
          </label>
          <input
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 dark:text-gray-200 dark:bg-gray-800 dark:border-gray-600 leading-tight focus:outline-none focus:shadow-outline"
            id="username"
            type="text"
            name="username"
            placeholder="name / name@company.com"
            value={credentials.username}
            onChange={handleChange}
            required
          />
        </div>
        <div className="mb-4">
          <label className="block text-gray-700 dark:text-gray-200 text-sm font-bold mb-2" htmlFor="password">
            Password
          </label>
          <input
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 dark:text-gray-200 dark:bg-gray-800 dark:border-gray-600 mb-3 leading-tight focus:outline-none focus:shadow-outline"
            id="password"
            type="password"
            name="password"
            placeholder="Enter your password"
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
            <span className="text-sm text-gray-700 dark:text-gray-200">Remember me</span>
          </label>
        </div>
        <div className="flex w-full">
          <Button type="submit">
            Login
          </Button>
        </div>
      </form>
      <div className="text-center text-sm text-gray-600 dark:text-gray-400">
        No account yet?{' '}
        <a
          href={clientUrl ?? ''}
          target="_blank"
          rel="noopener noreferrer"
          className="text-orange-500 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-500"
        >
          Create new vault
        </a>
      </div>
    </div>
  );
};

export default Login;
