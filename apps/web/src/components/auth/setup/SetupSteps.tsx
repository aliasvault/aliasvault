import { apiErrorMessage } from '@aliasvault/client/api/errors/ApiErrorMessage';
import { ApiRequestError } from '@aliasvault/client/api/errors/ApiRequestError';
import { MIN_ACCEPTED_PASSWORD_LENGTH } from '@aliasvault/client/utilities/PasswordStrength';
import React, { useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import GlobalNotificationDisplay from '@/components/alerts/GlobalNotificationDisplay';
import PasswordInputField from '@/components/auth/PasswordInputField';
import TermsModal from '@/components/auth/setup/TermsModal';
import EditFormRow from '@/components/forms/EditFormRow';
import FormLabel from '@/components/shared/FormLabel';
import PasswordStrengthIndicator from '@/components/shared/PasswordStrengthIndicator';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationContext';
import { useWebApi } from '@/context/WebApiContext';
import { RegistrationService } from '@/services/RegistrationService';

const STEP_LOADING_MS = 300;
const USERNAME_DEBOUNCE_MS = 300;
const PASSWORD_DEBOUNCE_MS = 800;

/**
 * Show a spinner briefly, then fade the step in.
 */
const useStepLoading = (): boolean => {
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), STEP_LOADING_MS);
    return (): void => clearTimeout(timer);
  }, []);
  return isLoading;
};

/**
 * The spinner and fade wrapper shared by the steps.
 */
const StepFrame: React.FC<{ isLoading: boolean; children: React.ReactNode }> = ({ isLoading, children }) => (
  <div className="w-full mx-auto">
    {isLoading && (
      <div className="absolute inset-0 flex justify-center items-center z-10">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary-500"></div>
      </div>
    )}
    <div className={`${isLoading ? 'invisible opacity-0' : 'opacity-100'} transition-opacity duration-300 w-full`}>
      {children}
    </div>
  </div>
);

/**
 * Step 1: pick a username.
 */
export const UsernameStep: React.FC<{ defaultUsername: string; inviteCode?: string; onUsernameChange: (username: string) => void }> = ({ defaultUsername, inviteCode, onUsernameChange }) => {
  const { t } = useTranslation();
  const webApi = useWebApi();
  const isLoading = useStepLoading();
  const [username, setUsername] = useState(defaultUsername);
  const [isValidating, setIsValidating] = useState(false);
  const [isValid, setIsValid] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Ask the server whether the username can be used.
   */
  const validateUsername = async (value: string): Promise<void> => {
    if (value.trim().length === 0) {
      setIsValidating(false);
      setIsValid(false);
      setErrorMessage(t('apiErrors.USERNAME_REQUIRED'));
      onUsernameChange('');
      return;
    }
    try {
      await webApi.post<{ username: string; inviteCode?: string }, unknown>('Auth/validate-username', { username: value, inviteCode }, false);
      setIsValid(true);
      setErrorMessage('');
      onUsernameChange(value);
    } catch (error) {
      setIsValid(false);
      setErrorMessage(error instanceof ApiRequestError ? apiErrorMessage(error, t, t('auth.setup.usernameStep.serverCommunicationError')) : t('auth.setup.usernameStep.serverCommunicationError'));
      onUsernameChange('');
    } finally {
      setIsValidating(false);
    }
  };

  useEffect(() => {
    if (defaultUsername.trim().length > 0) {
      void validateUsername(defaultUsername);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autofocus the username input.
  useEffect(() => {
    if (!isLoading) {
      document.getElementById('username')?.focus();
    }
  }, [isLoading]);

  /**
   * Validate after a typing pause.
   */
  const onChange = (value: string): void => {
    setUsername(value);
    setIsValidating(true);
    setIsValid(false);
    setErrorMessage('');
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = setTimeout(() => void validateUsername(value), USERNAME_DEBOUNCE_MS);
  };

  return (
    <StepFrame isLoading={isLoading}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg lg:shadow-none p-6 mb-6">
        <div className="flex items-start mb-4">
          <div className="flex-shrink-0">
            <img className="h-10 w-10" src="/img/logo.svg" alt={t('auth.setup.usernameStep.assistantAvatarAlt')} />
          </div>
          <div className="ml-3 bg-blue-100 dark:bg-blue-900 rounded-lg p-3">
            <p className="text-sm text-gray-900 dark:text-white">{t('auth.setup.usernameStep.welcomeMessage')}</p>
            <p className="text-sm text-gray-900 dark:text-white mt-3">{t('auth.setup.usernameStep.enterUsernameInstructions')}</p>
            <p className="text-sm text-gray-900 dark:text-white mt-3 font-semibold">{t('auth.setup.usernameStep.rememberUsernameNote')}</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <EditFormRow id="username" label={t('common.username')} value={username} onChange={onChange} placeholder={t('auth.setup.usernameStep.usernamePlaceholder')} onFocus={() => {
            setIsValid(false);
            setIsValidating(false);
            setErrorMessage('');
          }} />
          {isValidating
            ? <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">{t('auth.setup.usernameStep.validatingUsernameMessage')}</div>
            : isValid
              ? <div className="mt-2 text-sm text-green-600 dark:text-green-400">{t('apiErrors.USERNAME_AVAILABLE')}</div>
              : errorMessage.length > 0 && <div className="mt-2 text-sm text-red-600 dark:text-red-400">{errorMessage}</div>}
        </div>
      </div>
    </StepFrame>
  );
};

/**
 * Step 2: choose the master password.
 */
export const PasswordStep: React.FC<{ termsUrl: string; agreedToTerms: boolean; onAgreedToTermsChange: (agreed: boolean) => void; onPasswordChange: (password: string) => void }> = ({ termsUrl, agreedToTerms, onAgreedToTermsChange, onPasswordChange }) => {
  const { t } = useTranslation();
  const [showTerms, setShowTerms] = useState(false);
  const isLoading = useStepLoading();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The debounced check reads the confirmation at fire time, so a quickly filled confirm field is not validated as empty.
  const confirmPasswordRef = useRef('');

  // Autofocus the password input.
  useEffect(() => {
    if (!isLoading) {
      document.getElementById('password')?.focus();
    }
  }, [isLoading]);

  /**
   * Length and match checks.
   */
  const validate = (value: string, confirm: string): void => {
    if (value.length < MIN_ACCEPTED_PASSWORD_LENGTH) {
      setErrorMessage(t('settings.securitySettings.changePassword.passwordTooShort', { minLength: MIN_ACCEPTED_PASSWORD_LENGTH }));
      onPasswordChange('');
      return;
    }
    if (confirm.trim().length === 0) {
      setErrorMessage('');
      onPasswordChange('');
      return;
    }
    if (value !== confirm) {
      setErrorMessage(t('common.errorPasswordMismatch'));
      onPasswordChange('');
      return;
    }
    setErrorMessage('');
    onPasswordChange(value);
  };

  /**
   * Validate after a typing pause.
   */
  const onPasswordInput = (value: string): void => {
    setPassword(value);
    setErrorMessage('');
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = setTimeout(() => validate(value, confirmPasswordRef.current), PASSWORD_DEBOUNCE_MS);
  };

  /**
   * Validate right away.
   */
  const onConfirmInput = (value: string): void => {
    setConfirmPassword(value);
    confirmPasswordRef.current = value;
    validate(password, value);
  };

  return (
    <StepFrame isLoading={isLoading}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg lg:shadow-none p-6">
        <div className="flex items-start mb-4">
          <div className="flex-shrink-0">
            <img className="h-10 w-10" src="/img/logo.svg" alt={t('auth.setup.usernameStep.assistantAvatarAlt')} />
          </div>
          <div className="ml-3 bg-blue-100 dark:bg-blue-900 rounded-lg p-3">
            <p className="text-sm text-gray-900 dark:text-white">{t('auth.setup.passwordStep.welcomeMessage')}</p>
          </div>
        </div>
      </div>

      <div className="p-4 mb-6 bg-gray-100 dark:bg-gray-900 rounded-lg text-gray-900 dark:text-gray-100">
        <p className="text-sm font-semibold">{t('auth.setup.passwordStep.importantNote')}</p>
        <ul className="text-sm mt-3 list-disc list-inside">
          <li>{t('auth.setup.passwordStep.securityPoint1')}</li>
          <li>{t('auth.setup.passwordStep.securityPoint2')}</li>
          <li>{t('auth.setup.passwordStep.securityPoint3')}</li>
        </ul>
      </div>

      <div className="space-y-4">
        <div>
          <div>
            <FormLabel htmlFor="password">{t('auth.masterPassword')}</FormLabel>
            <PasswordInputField id="password" value={password} onValueChange={onPasswordInput} placeholder={t('auth.setup.passwordStep.masterPasswordPlaceholder')} />
          </div>

          <PasswordStrengthIndicator password={password} />

          <div className="mt-4">
            <FormLabel htmlFor="confirmPassword">{t('auth.setup.passwordStep.confirmMasterPasswordLabel')}</FormLabel>
            <PasswordInputField id="confirmPassword" value={confirmPassword} onValueChange={onConfirmInput} placeholder={t('auth.setup.passwordStep.confirmMasterPasswordPlaceholder')} />
          </div>
          {errorMessage.length > 0 && <div className="mt-2 text-sm text-red-600 dark:text-red-400">{errorMessage}</div>}
        </div>
        {termsUrl && (
          <div className="flex items-start">
            <input type="checkbox" id="agreeTerms" checked={agreedToTerms} onChange={e => onAgreedToTermsChange(e.target.checked)} className="mt-0.5 mr-2" />
            <label htmlFor="agreeTerms" className="text-sm text-gray-600 dark:text-gray-400">
              <Trans i18nKey="auth.setup.termsAgreementLabel" components={{ termsLink: <button type="button" onClick={() => setShowTerms(true)} className="text-primary-700 dark:text-primary-400 hover:underline" /> }} />
            </label>
          </div>
        )}
      </div>
      {showTerms && <TermsModal termsUrl={termsUrl} onClose={() => setShowTerms(false)} />}
    </StepFrame>
  );
};

/**
 * Step 3: create the account.
 */
export const CreatingStep: React.FC<{ username: string; password: string; inviteCode?: string; onDone: () => void }> = ({ username, password, inviteCode, onDone }) => {
  const { t } = useTranslation();
  const auth = useAuth();
  const webApi = useWebApi();
  const notifications = useNotifications();
  const [isLoading, setIsLoading] = useState(true);
  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current) {
      return;
    }
    hasStarted.current = true;

    /**
     * Register and continue.
     */
    const completeSetup = async (): Promise<void> => {
      try {
        await RegistrationService.register(webApi, username, password, auth.setAuthTokens, inviteCode);
        onDone();
      } catch (error) {
        console.error('Registration failed:', error);
        setIsLoading(false);
        notifications.addErrorMessage(apiErrorMessage(error, t, t('auth.register.registrationErrorMessage')), true);
      }
    };
    void completeSetup();
  }, [auth.setAuthTokens, inviteCode, notifications, onDone, password, t, username, webApi]);

  return (
    <div className="w-full mx-auto">
      <div className="relative inset-0 mt-10 z-10">
        <GlobalNotificationDisplay />
        {isLoading && (
          <div className="flex justify-center items-center">
            <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary-500"></div>
          </div>
        )}
      </div>
    </div>
  );
};
