import { ApiRequestError } from '@aliasvault/client/api/errors/ApiRequestError';
import { MIN_ACCEPTED_PASSWORD_LENGTH } from '@aliasvault/client/utilities/PasswordStrength';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import GlobalNotificationDisplay from '@/components/alerts/GlobalNotificationDisplay';
import PasswordInputField from '@/components/auth/PasswordInputField';
import EditFormRow from '@/components/forms/EditFormRow';
import PasswordStrengthIndicator from '@/components/shared/PasswordStrengthIndicator';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationContext';
import { useWebApi } from '@/context/WebApiContext';
import { RegistrationService } from '@/services/RegistrationService';
import { apiErrorMessage } from '@/utils/ApiErrors';

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
 * Step 1: read and accept the terms.
 */
export const TermsAndConditionsStep: React.FC<{ agreedToTerms: boolean; onAgreedToTermsChange: (agreed: boolean) => void }> = ({ agreedToTerms, onAgreedToTermsChange }) => {
  const { t } = useTranslation();
  const isLoading = useStepLoading();
  const tk = 'components.auth.setup.termsAndConditionsStep';

  return (
    <StepFrame isLoading={isLoading}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg lg:shadow-none p-6">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{t(`${tk}.PleaseReadAndAgree`)}</p>
        <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-4 mb-8 h-80 overflow-y-auto">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">{t(`${tk}.TermsAndConditionsTitle`)}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-line">{t(`${tk}.TermsContent`)}</p>
        </div>
        <div className="flex items-center">
          <input type="checkbox" id="agreeTerms" checked={agreedToTerms} onChange={e => onAgreedToTermsChange(e.target.checked)} className="mr-2" />
          <label htmlFor="agreeTerms" className="text-sm font-bold text-gray-600 dark:text-gray-400">{t(`${tk}.AgreementCheckboxLabel`)}</label>
        </div>
      </div>
    </StepFrame>
  );
};

/**
 * Step 2: pick a username.
 */
export const UsernameStep: React.FC<{ defaultUsername: string; onUsernameChange: (username: string) => void }> = ({ defaultUsername, onUsernameChange }) => {
  const { t } = useTranslation();
  const webApi = useWebApi();
  const isLoading = useStepLoading();
  const [username, setUsername] = useState(defaultUsername);
  const [isValidating, setIsValidating] = useState(false);
  const [isValid, setIsValid] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tk = 'components.auth.setup.usernameStep';

  /**
   * Ask the server whether the username can be used.
   */
  const validateUsername = async (value: string): Promise<void> => {
    if (value.trim().length === 0) {
      setIsValidating(false);
      setIsValid(false);
      setErrorMessage(t(`${tk}.UsernameRequiredError`));
      onUsernameChange('');
      return;
    }
    try {
      await webApi.post<{ username: string }, unknown>('Auth/validate-username', { username: value }, false);
      setIsValid(true);
      setErrorMessage('');
      onUsernameChange(value);
    } catch (error) {
      setIsValid(false);
      setErrorMessage(error instanceof ApiRequestError ? apiErrorMessage(error, t, t(`${tk}.ServerCommunicationError`)) : t(`${tk}.ServerCommunicationError`));
      onUsernameChange('');
    } finally {
      setIsValidating(false);
    }
  };

  useEffect(() => {
    if (defaultUsername.trim().length > 0) {
      void validateUsername(defaultUsername);
    }
    const timer = setTimeout(() => document.getElementById('username')?.focus(), 100);
    return (): void => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            <img className="h-10 w-10" src="/img/logo.svg" alt={t(`${tk}.AssistantAvatarAlt`)} />
          </div>
          <div className="ml-3 bg-blue-100 dark:bg-blue-900 rounded-lg p-3">
            <p className="text-sm text-gray-900 dark:text-white">{t(`${tk}.GreatNowLetsSetupUsername`)}</p>
            <p className="text-sm text-gray-900 dark:text-white mt-3">{t(`${tk}.EnterUsernameInstructions`)}</p>
            <p className="text-sm text-gray-900 dark:text-white mt-3 font-semibold">{t(`${tk}.RememberUsernameNote`)}</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <EditFormRow id="username" label={t(`${tk}.UsernameLabel`)} value={username} onChange={onChange} placeholder={t(`${tk}.UsernamePlaceholder`)} onFocus={() => {
            setIsValid(false);
            setIsValidating(false);
            setErrorMessage('');
          }} />
          {isValidating
            ? <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">{t(`${tk}.ValidatingUsernameMessage`)}</div>
            : isValid
              ? <div className="mt-2 text-sm text-green-600 dark:text-green-400">{t(`${tk}.UsernameAvailableMessage`)}</div>
              : errorMessage.length > 0 && <div className="mt-2 text-sm text-red-600 dark:text-red-400">{errorMessage}</div>}
        </div>
      </div>
    </StepFrame>
  );
};

/**
 * Step 3: choose the master password.
 */
export const PasswordStep: React.FC<{ onPasswordChange: (password: string) => void }> = ({ onPasswordChange }) => {
  const { t } = useTranslation();
  const isLoading = useStepLoading();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tk = 'components.auth.setup.passwordStep';

  useEffect(() => {
    const timer = setTimeout(() => document.getElementById('password')?.focus(), 100);
    return (): void => clearTimeout(timer);
  }, []);

  /**
   * Length and match checks.
   */
  const validate = (value: string, confirm: string): void => {
    if (value.length < MIN_ACCEPTED_PASSWORD_LENGTH) {
      setErrorMessage(t('validationMessages.PasswordMinLengthGeneric', { 0: MIN_ACCEPTED_PASSWORD_LENGTH }));
      onPasswordChange('');
      return;
    }
    if (confirm.trim().length === 0) {
      setErrorMessage('');
      onPasswordChange('');
      return;
    }
    if (value !== confirm) {
      setErrorMessage(t('validationMessages.PasswordsDoNotMatchGeneric'));
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
    debounceTimer.current = setTimeout(() => validate(value, confirmPassword), PASSWORD_DEBOUNCE_MS);
  };

  /**
   * Validate right away.
   */
  const onConfirmInput = (value: string): void => {
    setConfirmPassword(value);
    validate(password, value);
  };

  return (
    <StepFrame isLoading={isLoading}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg lg:shadow-none p-6">
        <div className="flex items-start mb-4">
          <div className="flex-shrink-0">
            <img className="h-10 w-10" src="/img/logo.svg" alt="AliasVault Assistant" />
          </div>
          <div className="ml-3 bg-blue-100 dark:bg-blue-900 rounded-lg p-3">
            <p className="text-sm text-gray-900 dark:text-white">{t(`${tk}.WelcomeMessage`)}</p>
          </div>
        </div>
      </div>

      <div className="p-4 mb-6 bg-gray-100 dark:bg-gray-900 rounded-lg text-gray-900 dark:text-gray-100">
        <p className="text-sm font-semibold">{t(`${tk}.ImportantNote`)}</p>
        <ul className="text-sm mt-3 list-disc list-inside">
          <li>{t(`${tk}.SecurityPoint1`)}</li>
          <li>{t(`${tk}.SecurityPoint2`)}</li>
          <li>{t(`${tk}.SecurityPoint3`)}</li>
        </ul>
      </div>

      <div className="space-y-4">
        <div>
          <div>
            <label htmlFor="password" className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">{t(`${tk}.MasterPasswordLabel`)}</label>
            <PasswordInputField id="password" value={password} onValueChange={onPasswordInput} placeholder={t(`${tk}.MasterPasswordPlaceholder`)} />
          </div>

          <PasswordStrengthIndicator password={password} />

          <div className="mt-4">
            <label htmlFor="confirmPassword" className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">{t(`${tk}.ConfirmMasterPasswordLabel`)}</label>
            <PasswordInputField id="confirmPassword" value={confirmPassword} onValueChange={onConfirmInput} placeholder={t(`${tk}.ConfirmMasterPasswordPlaceholder`)} />
          </div>
          {errorMessage.length > 0 && <div className="mt-2 text-sm text-red-600 dark:text-red-400">{errorMessage}</div>}
        </div>
      </div>
    </StepFrame>
  );
};

/**
 * Step 4: create the account.
 */
export const CreatingStep: React.FC<{ username: string; password: string; onDone: () => void }> = ({ username, password, onDone }) => {
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
        await RegistrationService.register(webApi, username, password, auth.setAuthTokens);
        onDone();
      } catch (error) {
        console.error('Registration failed:', error);
        setIsLoading(false);
        notifications.addErrorMessage(apiErrorMessage(error, t, t('components.auth.register.RegistrationErrorMessage')), true);
      }
    };
    void completeSetup();
  }, [auth.setAuthTokens, notifications, onDone, password, t, username, webApi]);

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
