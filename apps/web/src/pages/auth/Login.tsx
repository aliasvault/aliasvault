import { ApiAuthError } from '@aliasvault/client/api/errors/ApiAuthError';
import { getErrorMessage, hasErrorCode } from '@aliasvault/client/api/errors/AppErrorCodes';
import { ClientUpgradeRequiredError } from '@aliasvault/client/api/errors/ClientUpgradeRequiredError';
import { ServerUpdateRequiredError } from '@aliasvault/client/api/errors/ServerUpdateRequiredError';
import { SrpAuthService } from '@aliasvault/client/auth/SrpAuthService';
import { SrpLoginService } from '@aliasvault/client/auth/SrpLoginService';
import { VaultKeyService } from '@aliasvault/client/auth/VaultKeyService';
import { getPlatform } from '@aliasvault/client/platform';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import ServerValidationErrors from '@/components/alerts/ServerValidationErrors';
import InputTextField from '@/components/auth/InputTextField';
import PasswordInputField from '@/components/auth/PasswordInputField';
import FooterLogin from '@/components/layout/FooterLogin';
import { getAppConfig } from '@/config/AppConfig';
import { useAuth } from '@/context/AuthContext';
import { useLoading } from '@/context/LoadingContext';
import { useNotifications } from '@/context/NotificationContext';
import { useWebApi } from '@/context/WebApiContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { StorageKeys } from '@/utils/StorageKeys';
import { vaultStore } from '@/vault/VaultStore';

import type { LoginResponse, ValidateLoginResponse } from '@aliasvault/models/webapi';

/** Which step of the login the page shows. */
type LoginStep = 'credentials' | 'two-factor' | 'recovery-code';

/**
 * Login page: SRP login with the master password, with 2FA and recovery code steps.
 */
const Login: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const auth = useAuth();
  const webApi = useWebApi();
  const notifications = useNotifications();
  const { showLoading, hideLoading } = useLoading();
  const srpUtil = useMemo(() => new SrpLoginService(webApi), [webApi]);
  usePageTitle(t('components.auth.login.PageTitle'));

  const [step, setStep] = useState<LoginStep>('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [rememberMachine, setRememberMachine] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [loginResponse, setLoginResponse] = useState<LoginResponse | null>(null);
  const [passwordHashString, setPasswordHashString] = useState<string | null>(null);
  const [passwordHashBase64, setPasswordHashBase64] = useState<string | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const twoFactorRef = useRef<HTMLInputElement>(null);

  // Already authenticated: go home.
  useEffect(() => {
    if (auth.isInitialized && auth.isLoggedIn) {
      navigate('/', { replace: true });
    }
  }, [auth.isInitialized, auth.isLoggedIn, navigate]);

  // Show the message a forced logout left behind, and prefill the username it kept.
  useEffect(() => {
    if (auth.globalMessage) {
      notifications.addErrorMessage(auth.globalMessage, true);
      auth.clearGlobalMessage();
    }
    getPlatform().storage.get<string>(StorageKeys.USERNAME).then((saved) => {
      if (saved) {
        setUsername(current => current || saved);
      }
    });
    const timer = setTimeout(() => usernameRef.current?.focus(), 300);
    return (): void => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (step === 'two-factor') {
      const timer = setTimeout(() => twoFactorRef.current?.focus(), 100);
      return (): void => clearTimeout(timer);
    }
  }, [step]);

  /**
   * Turn a failure into the message(s) the form shows.
   */
  const toErrorMessages = (err: unknown): string[] => {
    console.error('Login error:', err);
    if (err instanceof ClientUpgradeRequiredError) {
      return [t('common.errors.clientVersionNotSupported')];
    }
    if (err instanceof ServerUpdateRequiredError) {
      return [t('common.errors.serverVersionNotSupported')];
    }
    if (err instanceof ApiAuthError) {
      const key = `apiErrors.${err.message}`;
      return [t(key) === key ? err.message : t(key)];
    }
    if (hasErrorCode(err)) {
      return [getErrorMessage(err, t('components.auth.login.LoginErrorMessage'))];
    }
    if (import.meta.env.DEV && err instanceof Error) {
      return [err.message];
    }
    return [t('components.auth.login.LoginErrorMessage')];
  };

  /**
   * Store the tokens and the unlock key, then continue to the sync page which loads the vault.
   */
  const processLoginVerify = async (validateLoginResponse: ValidateLoginResponse, hashBase64: string, response: LoginResponse): Promise<void> => {
    if (!validateLoginResponse.token) {
      throw new Error(t('components.auth.login.LoginRequestErrorMessage'));
    }

    const normalizedUsername = SrpAuthService.normalizeUsername(username);
    await auth.setAuthTokens(normalizedUsername, validateLoginResponse.token.token, validateLoginResponse.token.refreshToken);

    // Fetch the key chain, check the unlock key opens it and cache it; the vault key is derived from the two on demand.
    await VaultKeyService.refreshKeyChain(hashBase64, webApi);
    await vaultStore.storeUnlockKeyDerivationParams({ salt: response.salt, encryptionType: response.encryptionType, encryptionSettings: response.encryptionSettings });
    await vaultStore.storeUnlockKey(hashBase64);

    notifications.clearMessages();
    navigate('/sync', { replace: true });
  };

  /**
   * Username and password step.
   */
  const handleLogin = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    showLoading(t('components.auth.login.LoggingInMessage'));
    setErrors([]);

    try {
      notifications.clearMessages();
      const normalizedUsername = SrpAuthService.normalizeUsername(username);
      const response = await srpUtil.initiateLogin(normalizedUsername);

      // Derive the KEK from the password.
      const prepared = await SrpAuthService.prepareCredentials(password, response.salt, response.encryptionSettings);
      const validateLoginResponse = await srpUtil.validateLogin(normalizedUsername, prepared.passwordHashString, rememberMe, response);

      if (validateLoginResponse.requiresTwoFactor) {
        setLoginResponse(response);
        setPasswordHashString(prepared.passwordHashString);
        setPasswordHashBase64(prepared.passwordHashBase64);
        setStep('two-factor');
        return;
      }

      await processLoginVerify(validateLoginResponse, prepared.passwordHashBase64, response);
    } catch (err) {
      setErrors(toErrorMessages(err));
    } finally {
      hideLoading();
    }
  };

  /**
   * Authenticator code step.
   */
  const handle2Fa = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    showLoading(t('components.auth.login.VerifyingTwoFactorCodeMessage'));
    setErrors([]);

    try {
      if (!loginResponse || !passwordHashString || !passwordHashBase64) {
        throw new Error(t('components.auth.login.LoginRequestErrorMessage'));
      }
      const code = twoFactorCode.trim();
      if (!/^\d{6}$/.test(code)) {
        throw new Error(t('common.errors.invalidCode'));
      }
      const validateLoginResponse = await srpUtil.validateLogin2Fa(username, passwordHashString, rememberMe || rememberMachine, loginResponse, parseInt(code, 10));
      await processLoginVerify(validateLoginResponse, passwordHashBase64, loginResponse);
    } catch (err) {
      setErrors(toErrorMessages(err));
    } finally {
      hideLoading();
    }
  };

  /**
   * Recovery code step.
   */
  const handleRecoveryCode = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    showLoading(t('components.auth.login.VerifyingRecoveryCodeMessage'));
    setErrors([]);

    try {
      if (!loginResponse || !passwordHashString || !passwordHashBase64) {
        throw new Error(t('components.auth.login.LoginRequestErrorMessage'));
      }
      const validateLoginResponse = await srpUtil.validateLoginRecoveryCode(username, passwordHashString, rememberMe, loginResponse, recoveryCode.trim());
      await processLoginVerify(validateLoginResponse, passwordHashBase64, loginResponse);
    } catch (err) {
      setErrors(toErrorMessages(err));
    } finally {
      hideLoading();
    }
  };

  const inputClass = 'bg-gray-50 border border-gray-300 text-gray-900 sm:text-sm rounded-lg focus:ring-primary-600 focus:border-primary-600 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500';
  const submitClass = 'w-full text-white bg-primary-600 hover:bg-primary-700 focus:ring-4 focus:outline-none focus:ring-primary-300 font-medium rounded-lg text-sm px-5 py-2.5 text-center dark:bg-primary-600 dark:hover:bg-primary-700 dark:focus:ring-primary-800';

  if (step === 'two-factor') {
    return (
      <>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
          {t('components.auth.login.TwoFactorAuthenticationTitle')}
        </h2>

        <ServerValidationErrors errors={errors} />

        <p className="text-gray-700 dark:text-gray-300 mb-6">{t('components.auth.login.TwoFactorAuthenticationDescription')}</p>
        <div className="w-full">
          <form onSubmit={handle2Fa} className="space-y-6" av-enable="true" av-suppress-save="true">
            <div>
              <label htmlFor="two-factor-code" className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">{t('components.auth.login.AuthenticatorCodeLabel')}</label>
              <input ref={twoFactorRef} id="two-factor-code" type="number" value={twoFactorCode} onChange={(e) => setTwoFactorCode(e.target.value)} className={inputClass} autoComplete="one-time-code" />
            </div>
            <div className="flex items-start">
              <div className="flex items-center h-5">
                <input id="remember-machine" type="checkbox" checked={rememberMachine} onChange={(e) => setRememberMachine(e.target.checked)} className="w-4 h-4 border border-gray-300 rounded bg-gray-50 focus:ring-3 focus:ring-primary-300 dark:bg-gray-700 dark:border-gray-600 dark:focus:ring-primary-600 dark:ring-offset-gray-800" />
              </div>
              <div className="ml-3 text-sm">
                <label htmlFor="remember-machine" className="font-medium text-gray-900 dark:text-white">{t('components.auth.login.RememberMachineLabel')}</label>
              </div>
            </div>
            <button type="submit" className={submitClass}>{t('components.auth.login.LoginButton')}</button>
          </form>
        </div>
        <p className="mt-6 text-sm text-gray-700 dark:text-gray-300">
          {t('components.auth.login.DontHaveAuthenticatorText')}
        </p>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          <button onClick={() => {
            setErrors([]); setStep('recovery-code'); 
          }} className="text-primary-600 hover:underline dark:text-primary-500">{t('components.auth.login.LoginWithRecoveryCodeLink')}</button>
        </p>
        <FooterLogin />
      </>
    );
  }

  if (step === 'recovery-code') {
    return (
      <>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
          {t('components.auth.login.RecoveryCodeVerificationTitle')}
        </h2>

        <ServerValidationErrors errors={errors} />

        <p className="text-gray-700 dark:text-gray-300 mb-6">
          {t('components.auth.login.RecoveryCodeDescription')}
        </p>
        <div className="w-full">
          <form onSubmit={handleRecoveryCode} className="space-y-6">
            <div>
              <label htmlFor="recovery-code" className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">{t('components.auth.login.RecoveryCodeLabel')}</label>
              <input id="recovery-code" type="text" value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} className={inputClass} autoComplete="off" />
            </div>
            <button type="submit" className={submitClass}>{t('components.auth.login.LoginButton')}</button>
          </form>
        </div>
        <p className="mt-6 text-sm text-gray-700 dark:text-gray-300">
          {t('components.auth.login.RegainedAccessText')}
        </p>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          <button onClick={() => {
            setErrors([]); setStep('two-factor'); 
          }} className="text-primary-600 hover:underline dark:text-primary-500">{t('components.auth.login.LoginWithAuthenticatorLink')}</button>
        </p>
        <FooterLogin />
      </>
    );
  }

  return (
    <>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
        {t('components.auth.login.PageTitle')}
      </h2>

      <form onSubmit={handleLogin} className="mt-4 space-y-6" av-enable="true" av-suppress-save="true">
        <ServerValidationErrors errors={errors} />
        <div>
          <label htmlFor="email" className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">{t('components.auth.login.UsernameOrEmailLabel')}</label>
          <InputTextField ref={usernameRef} id="email" value={username} onValueChange={setUsername} type="text" placeholder={t('components.auth.login.UsernamePlaceholder')} autoCapitalize="off" autoCorrect="off" required />
        </div>
        <div>
          <label htmlFor="password" className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">{t('components.auth.login.PasswordLabel')}</label>
          <PasswordInputField id="password" value={password} onValueChange={setPassword} placeholder={t('components.auth.login.PasswordPlaceholder')} />
        </div>

        <div className="flex items-start">
          <div className="flex items-center h-5">
            <input id="remember" type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="w-4 h-4 border-gray-300 rounded bg-gray-50 focus:ring-3 focus:ring-primary-300 dark:focus:ring-primary-600 dark:ring-offset-gray-800 dark:bg-gray-700 dark:border-gray-600" />
          </div>
          <div className="ml-3 text-sm">
            <label htmlFor="remember" className="font-medium text-gray-900 dark:text-white">{t('components.auth.login.RememberMeLabel')}</label>
          </div>
          <Link to="/user/forgot-password" className="ml-auto text-sm text-primary-700 hover:underline dark:text-primary-500">{t('components.auth.login.LostPasswordLink')}</Link>
        </div>

        <div className="flex flex-col gap-4">
          <button type="submit" id="login-button" className="w-full px-5 py-2 text-base font-medium text-center text-white bg-primary-700 rounded-lg hover:bg-primary-800 focus:ring-4 focus:ring-primary-300 dark:bg-primary-600 dark:hover:bg-primary-700 dark:focus:ring-primary-800 flex items-center justify-center gap-2">
            {t('components.auth.login.LoginButton')}
          </button>
          {/* TODO: mobile app login (QR code) is not implemented yet. */}
        </div>

        {getAppConfig().publicRegistrationEnabled && (
          <div className="text-sm font-medium text-gray-500 dark:text-gray-400 text-center">
            {t('components.auth.login.NoAccountYetText')} <Link to="/user/setup" className="text-primary-700 hover:underline dark:text-primary-500">{t('components.auth.login.CreateNewVaultLink')}</Link>
          </div>
        )}
      </form>

      <FooterLogin />
    </>
  );
};

export default Login;
