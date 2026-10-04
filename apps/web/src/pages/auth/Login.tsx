import { extractErrorCode } from '@aliasvault/client/api/errors/AppErrorCodes';
import { describeAuthError, formatErrorMessage } from '@aliasvault/client/auth/AuthErrorMessage';
import { SrpAuthService, type PreparedCredentials } from '@aliasvault/client/auth/SrpAuthService';
import { SrpLoginService } from '@aliasvault/client/auth/SrpLoginService';
import { VaultKeyService } from '@aliasvault/client/auth/VaultKeyService';
import { getPlatform } from '@aliasvault/client/platform';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import CriticalErrorPanel from '@/components/alerts/CriticalErrorPanel';
import ServerValidationErrors from '@/components/alerts/ServerValidationErrors';
import MobileUnlockModal from '@/components/auth/MobileUnlockModal';
import PasswordInputField from '@/components/auth/PasswordInputField';
import FooterLogin from '@/components/layout/FooterLogin';
import Button from '@/components/shared/Button';
import FormLabel from '@/components/shared/FormLabel';
import Icon from '@/components/shared/Icon';
import InputTextField from '@/components/shared/InputTextField';
import { getAppConfig } from '@/config/AppConfig';
import { useAuth } from '@/context/AuthContext';
import { useLoading } from '@/context/LoadingContext';
import { useNotifications } from '@/context/NotificationContext';
import { useWebApi } from '@/context/WebApiContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { asksForClientUpdate, updateApp } from '@/utils/ClientUpdate';
import { focusWhenVisible } from '@/utils/FocusWhenVisible';
import { StorageKeys } from '@/utils/StorageKeys';
import { vaultStore } from '@/vault/VaultStore';

import type { MobileLoginResult } from '@aliasvault/client/auth/MobileLoginService';
import type { UnlockKeyDerivationParams } from '@aliasvault/models/metadata';
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
  usePageTitle(t('auth.loginTitle'));

  const [step, setStep] = useState<LoginStep>('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [rememberMachine, setRememberMachine] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [loginResponse, setLoginResponse] = useState<LoginResponse | null>(null);
  const [credentials, setCredentials] = useState<PreparedCredentials | null>(null);
  const [showMobileLoginModal, setShowMobileLoginModal] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const twoFactorRef = useRef<HTMLInputElement>(null);
  const isCompletingLogin = useRef(false);

  // Already authenticated: go home.
  useEffect(() => {
    if (auth.isInitialized && auth.isLoggedIn && !isCompletingLogin.current) {
      navigate('/', { replace: true });
    }
  }, [auth.isInitialized, auth.isLoggedIn, navigate]);

  // Show the message a forced logout left behind, and prefill the username it kept.
  useEffect(() => {
    if (auth.globalMessage) {
      // A coded message or an update request shows as a critical error in place of the form.
      if (extractErrorCode(auth.globalMessage) || asksForClientUpdate(auth.globalMessage)) {
        setErrors([auth.globalMessage]);
      } else {
        notifications.addErrorMessage(auth.globalMessage, true);
      }
      auth.clearGlobalMessage();
    }
    getPlatform().storage.get<string>(StorageKeys.USERNAME).then((saved) => {
      if (saved) {
        setUsername(current => current || saved);
      }
    });
    return focusWhenVisible(() => usernameRef.current);
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
  const toErrorMessages = async (err: unknown): Promise<string[]> => {
    console.error('Login error:', err);
    const message = await describeAuthError(err, { fallback: 'auth.loginForm.loginErrorMessage' });
    if (import.meta.env.DEV && err instanceof Error && message.key === 'auth.loginForm.loginErrorMessage') {
      return [err.message];
    }
    return [formatErrorMessage(message, t)];
  };

  /**
   * Store the tokens and the unlock key, then continue to the sync page which loads the vault.
   */
  const completeLogin = async (loginUsername: string, accessToken: string, refreshToken: string, unlockKey: string, params: UnlockKeyDerivationParams): Promise<void> => {
    isCompletingLogin.current = true;
    try {
      await auth.setAuthTokens(SrpAuthService.normalizeUsername(loginUsername), accessToken, refreshToken);

      // Fetch the key chain, check the unlock key opens it and cache it; the vault key is derived from the two on demand.
      let storedKey: string;
      try {
        storedKey = await VaultKeyService.refreshKeyChain(unlockKey, webApi);
      } catch (err) {
        // Without a usable key chain the session is useless; end it so the error shows on this form.
        await auth.logout();
        throw err;
      }
      await vaultStore.storeUnlockKeyDerivationParams(params);
      await vaultStore.storeUnlockKey(storedKey);

      notifications.clearMessages();
      navigate('/sync', { replace: true });
    } finally {
      isCompletingLogin.current = false;
    }
  };

  /**
   * Finish a password login once the server accepted it.
   */
  const processLoginVerify = async (validateLoginResponse: ValidateLoginResponse, hashBase64: string, response: LoginResponse): Promise<void> => {
    if (!validateLoginResponse.token) {
      throw new Error(t('auth.loginForm.loginRequestErrorMessage'));
    }
    const params = { salt: response.salt, encryptionType: response.encryptionType, encryptionSettings: response.encryptionSettings };
    await completeLogin(username, validateLoginResponse.token.token, validateLoginResponse.token.refreshToken, hashBase64, params);
  };

  /**
   * Finish a login the mobile app approved: the mobile app sends the unlock key.
   */
  const handleMobileLoginSuccess = async (result: MobileLoginResult): Promise<void> => {
    showLoading(t('auth.loggingIn'));
    setErrors([]);
    setShowMobileLoginModal(false);

    try {
      const params = { salt: result.salt, encryptionType: result.encryptionType, encryptionSettings: result.encryptionSettings };
      await completeLogin(result.username, result.token, result.refreshToken, result.unlockKey, params);
    } catch (err) {
      setErrors(await toErrorMessages(err));
    } finally {
      hideLoading();
    }
  };

  /**
   * Username and password step.
   */
  const handleLogin = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    showLoading(t('auth.loggingIn'));
    setErrors([]);

    try {
      notifications.clearMessages();
      const normalizedUsername = SrpAuthService.normalizeUsername(username);
      const response = await srpUtil.initiateLogin(normalizedUsername);

      // Derive the unlock key and the SRP password hash from the password.
      const prepared = await SrpAuthService.prepareLoginCredentials(password, response, normalizedUsername);
      const validateLoginResponse = await srpUtil.validateLogin(normalizedUsername, prepared, rememberMe, response);

      if (validateLoginResponse.requiresTwoFactor) {
        setLoginResponse(response);
        setCredentials(prepared);
        setStep('two-factor');
        return;
      }

      await processLoginVerify(validateLoginResponse, prepared.passwordHashBase64, response);
    } catch (err) {
      setErrors(await toErrorMessages(err));
    } finally {
      hideLoading();
    }
  };

  /**
   * Authenticator code step.
   */
  const handle2Fa = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    showLoading(t('auth.loginForm.verifyingTwoFactorCodeMessage'));
    setErrors([]);

    try {
      if (!loginResponse || !credentials) {
        throw new Error(t('auth.loginForm.loginRequestErrorMessage'));
      }
      const code = twoFactorCode.trim();
      if (!/^\d{6}$/.test(code)) {
        throw new Error(t('common.errors.invalidCode'));
      }
      const validateLoginResponse = await srpUtil.validateLogin2Fa(username, credentials, rememberMe || rememberMachine, loginResponse, parseInt(code, 10));
      await processLoginVerify(validateLoginResponse, credentials.passwordHashBase64, loginResponse);
    } catch (err) {
      setErrors(await toErrorMessages(err));
    } finally {
      hideLoading();
    }
  };

  /**
   * Recovery code step.
   */
  const handleRecoveryCode = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    showLoading(t('auth.loginForm.verifyingRecoveryCodeMessage'));
    setErrors([]);

    try {
      if (!loginResponse || !credentials) {
        throw new Error(t('auth.loginForm.loginRequestErrorMessage'));
      }
      const validateLoginResponse = await srpUtil.validateLoginRecoveryCode(username, credentials, rememberMe, loginResponse, recoveryCode.trim());
      await processLoginVerify(validateLoginResponse, credentials.passwordHashBase64, loginResponse);
    } catch (err) {
      setErrors(await toErrorMessages(err));
    } finally {
      hideLoading();
    }
  };

  // An update request blocks the app until the user loads the latest version.
  const updateRequest = errors.find(asksForClientUpdate);
  if (updateRequest) {
    return <CriticalErrorPanel title={t('common.errors.updateRequiredTitle')} description={updateRequest} onAction={updateApp} actionLabel={t('common.updateApp')} hideSupportContact />;
  }

  // A coded error is critical: it replaces the form.
  const criticalError = errors.find(error => extractErrorCode(error) !== null);
  if (criticalError) {
    /**
     * Dismiss the error and start the login over.
     */
    const backToLogin = (): void => {
      setErrors([]);
      setStep('credentials');
    };
    return <CriticalErrorPanel report={criticalError} onAction={backToLogin} />;
  }

  if (step === 'two-factor') {
    return (
      <>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
          {t('common.twoFactorAuthentication')}
        </h2>

        <ServerValidationErrors errors={errors} className="mb-4" />

        <p className="text-gray-700 dark:text-gray-300 mb-6">{t('auth.loginForm.twoFactorAuthenticationDescription')}</p>
        <div className="w-full">
          <form onSubmit={handle2Fa} className="space-y-6" av-enable="true" av-suppress-save="true">
            <div>
              <FormLabel htmlFor="two-factor-code">{t('auth.loginForm.authenticatorCodeLabel')}</FormLabel>
              <InputTextField ref={twoFactorRef} id="two-factor-code" type="number" value={twoFactorCode} onValueChange={setTwoFactorCode} autoComplete="one-time-code" />
            </div>
            <div className="flex items-start">
              <div className="flex items-center h-5">
                <input id="remember-machine" type="checkbox" checked={rememberMachine} onChange={(e) => setRememberMachine(e.target.checked)} className="w-4 h-4 border border-gray-300 rounded bg-gray-50 focus:ring-3 focus:ring-primary-300 dark:bg-gray-700 dark:border-gray-600 dark:focus:ring-primary-600 dark:ring-offset-gray-800" />
              </div>
              <div className="ml-3 text-sm">
                <label htmlFor="remember-machine" className="font-medium text-gray-900 dark:text-white">{t('auth.loginForm.rememberMachineLabel')}</label>
              </div>
            </div>
            <Button type="submit" size="lg" additionalClasses="w-full">{t('auth.login')}</Button>
          </form>
        </div>
        <p className="mt-6 text-sm text-gray-700 dark:text-gray-300">
          {t('auth.loginForm.dontHaveAuthenticatorText')}
        </p>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          <button onClick={() => {
            setErrors([]); setStep('recovery-code'); 
          }} className="text-primary-600 hover:underline dark:text-primary-500">{t('auth.loginForm.loginWithRecoveryCodeLink')}</button>
        </p>
        <FooterLogin />
      </>
    );
  }

  if (step === 'recovery-code') {
    return (
      <>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
          {t('auth.loginForm.recoveryCodeVerificationTitle')}
        </h2>

        <ServerValidationErrors errors={errors} className="mb-4" />

        <p className="text-gray-700 dark:text-gray-300 mb-6">
          {t('auth.loginForm.recoveryCodeDescription')}
        </p>
        <div className="w-full">
          <form onSubmit={handleRecoveryCode} className="space-y-6">
            <div>
              <FormLabel htmlFor="recovery-code">{t('auth.loginForm.recoveryCodeLabel')}</FormLabel>
              <InputTextField id="recovery-code" type="text" value={recoveryCode} onValueChange={setRecoveryCode} autoComplete="off" />
            </div>
            <Button type="submit" size="lg" additionalClasses="w-full">{t('auth.login')}</Button>
          </form>
        </div>
        <p className="mt-6 text-sm text-gray-700 dark:text-gray-300">
          {t('auth.loginForm.regainedAccessText')}
        </p>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          <button onClick={() => {
            setErrors([]); setStep('two-factor'); 
          }} className="text-primary-600 hover:underline dark:text-primary-500">{t('auth.loginForm.loginWithAuthenticatorLink')}</button>
        </p>
        <FooterLogin />
      </>
    );
  }

  return (
    <>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
        {t('auth.loginTitle')}
      </h2>

      <form onSubmit={handleLogin} className="mt-4 space-y-6" av-enable="true" av-suppress-save="true">
        <ServerValidationErrors errors={errors} />
        <div>
          <FormLabel htmlFor="email">{t('auth.register.usernameOrEmailLabel')}</FormLabel>
          <InputTextField ref={usernameRef} id="email" value={username} onValueChange={setUsername} type="text" placeholder={t('auth.usernamePlaceholder')} autoCapitalize="off" autoCorrect="off" required />
        </div>
        <div>
          <FormLabel htmlFor="password">{t('auth.register.passwordLabel')}</FormLabel>
          <PasswordInputField id="password" value={password} onValueChange={setPassword} placeholder={t('auth.register.passwordPlaceholder')} />
        </div>

        <div className="flex items-start">
          <div className="flex items-center h-5">
            <input id="remember" type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="w-4 h-4 border-gray-300 rounded bg-gray-50 focus:ring-3 focus:ring-primary-300 dark:focus:ring-primary-600 dark:ring-offset-gray-800 dark:bg-gray-700 dark:border-gray-600" />
          </div>
          <div className="ml-3 text-sm">
            <label htmlFor="remember" className="font-medium text-gray-900 dark:text-white">{t('auth.rememberMe')}</label>
          </div>
          <Link to="/user/forgot-password" className="ml-auto text-sm text-primary-700 hover:underline dark:text-primary-500">{t('auth.loginForm.lostPasswordLink')}</Link>
        </div>

        <div className="flex flex-col gap-4">
          <Button type="submit" id="login-button" size="lg" display="flex" additionalClasses="w-full">{t('auth.login')}</Button>
          <Button id="mobile-login-button" onClick={() => setShowMobileLoginModal(true)} color="outline" size="lg" display="flex" additionalClasses="hidden md:flex w-full">
            <Icon name="device-mobile" className="w-5 h-5" />
            {t('auth.loginWithMobile')}
          </Button>
        </div>

        {getAppConfig().publicRegistrationEnabled && (
          <div className="text-sm font-medium text-gray-500 dark:text-gray-400 text-center">
            {t('auth.noAccountYet')} <Link to="/user/setup" className="text-primary-700 hover:underline dark:text-primary-500">{t('auth.createNewVault')}</Link>
          </div>
        )}
      </form>

      <FooterLogin />

      <MobileUnlockModal isOpen={showMobileLoginModal} mode="login" onClose={() => setShowMobileLoginModal(false)} onSuccess={handleMobileLoginSuccess} />
    </>
  );
};

export default Login;
