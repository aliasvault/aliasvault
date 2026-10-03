import { apiErrorMessage } from '@aliasvault/client/api/errors/ApiErrorMessage';
import { apiErrorCodeOf } from '@aliasvault/client/api/errors/ApiRequestError';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import AlertMessageError from '@/components/alerts/AlertMessageError';
import AuthPreferences from '@/components/auth/AuthPreferences';
import Logo from '@/components/auth/Logo';
import { CreatingStep, PasswordStep, UsernameStep } from '@/components/auth/setup/SetupSteps';
import { ButtonLabel } from '@/components/shared/Button';
import Icon from '@/components/shared/Icon';
import { getAppConfig } from '@/config/AppConfig';
import { useWebApi } from '@/context/WebApiContext';
import { usePageTitle } from '@/hooks/usePageTitle';

/** The wizard steps, in order. */
const STEPS = ['username', 'password', 'creating'] as const;
type SetupStep = typeof STEPS[number];

/**
 * The create vault wizard: username, password (plus the terms checkbox when a terms URL is configured), then registration.
 * When public registration is disabled, the wizard only opens from a valid admin invite link (`?invite=<code>`).
 */
const Setup: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const webApi = useWebApi();
  const [searchParams] = useSearchParams();
  const requiresInvite = !getAppConfig().publicRegistrationEnabled;
  const inviteCode = requiresInvite ? (searchParams.get('invite') ?? '').trim() : '';
  const termsUrl = getAppConfig().termsUrl;

  usePageTitle(t('auth.setup.setupStepTitle'));

  const [step, setStep] = useState<SetupStep>('username');
  const [isCheckingInvite, setIsCheckingInvite] = useState(requiresInvite && inviteCode.length > 0);
  const [isInviteRejected, setIsInviteRejected] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Check the invite link up front, so an invalid or used link fails before the user fills in the wizard.
  useEffect(() => {
    if (!requiresInvite || inviteCode.length === 0) {
      return;
    }
    webApi.post<{ inviteCode: string }, unknown>('Auth/validate-invite-code', { inviteCode }, false)
      .catch((error: unknown) => {
        if (apiErrorCodeOf(error) === 'INVITE_CODE_INVALID') {
          setIsInviteRejected(true);
        } else {
          setInviteError(apiErrorMessage(error, t, t('auth.setup.usernameStep.serverCommunicationError')));
        }
      })
      .finally(() => setIsCheckingInvite(false));
  }, [inviteCode, requiresInvite, t, webApi]);

  const isBlocked = isCheckingInvite || inviteError.length > 0;
  const isPasswordStepComplete = password.trim().length > 0 && (!termsUrl || agreedToTerms);
  const isNextEnabled = step === 'username' ? username.trim().length > 0 : step === 'password' ? isPasswordStepComplete : false;
  const stepIndex = STEPS.indexOf(step);
  const progressPercentage = Math.floor(stepIndex * 100 / (STEPS.length - 1));

  /**
   * The title of a step.
   */
  const stepTitle = (): string => {
    switch (step) {
      case 'username': return t('auth.setup.usernameStepTitle');
      case 'password': return t('auth.setup.passwordStepTitle');
      default: return t('auth.setup.creatingStepTitle');
    }
  };

  /**
   * One step forward.
   */
  const goNext = (): void => {
    if (!isNextEnabled) {
      return;
    }
    setStep(STEPS[Math.min(stepIndex + 1, STEPS.length - 1)]);
    window.scrollTo({ top: 0 });
  };

  /**
   * One step back.
   */
  const goBack = (): void => {
    setStep(STEPS[Math.max(stepIndex - 1, 0)]);
  };

  const onRegistered = useCallback((): void => {
    navigate('/', { replace: true });
  }, [navigate]);

  if (requiresInvite && (inviteCode.length === 0 || isInviteRejected)) {
    return (
      <div className="flex flex-col items-center justify-center px-6 pt-8 pb-8 mx-auto md:h-screen relative">
        <Logo />
        <div className="w-full max-w-xl p-6 sm:p-8 bg-white rounded-lg shadow dark:bg-gray-800">
          <h2 className="mb-3 text-xl font-semibold text-gray-900 dark:text-white">{t('auth.setup.registrationDisabledTitle')}</h2>
          <p className="mb-6 text-gray-500 dark:text-gray-400">{isInviteRejected ? t('apiErrors.INVITE_CODE_INVALID') : t('auth.setup.registrationDisabledMessage')}</p>
          <Link to="/" className="text-primary-700 hover:underline dark:text-primary-500">{t('app.notFound.goHome')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex flex-col lg:items-center lg:justify-center">
      <div className="absolute top-4 right-4 z-10 mt-16 lg:mt-0 hidden lg:block">
        <AuthPreferences />
      </div>
      <div className="w-full mx-auto lg:max-w-xl lg:bg-white lg:dark:bg-gray-800 lg:shadow-xl lg:rounded-lg lg:overflow-hidden flex flex-col">
        <div className="flex flex-col flex-grow">
          <div className="flex-grow p-6 pt-4 lg:pt-6 pb-28 lg:pb-4">
            <div className="flex justify-between items-center mb-4">
              <div>
                <button type="button" onClick={goBack} className={`text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 ${stepIndex === 0 ? 'invisible' : ''}`}>
                  <Icon name="arrow-left" className="w-8 h-8" />
                </button>
              </div>
              <div className="flex-grow text-center">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{stepTitle()}</h2>
              </div>
              <button type="button" onClick={() => navigate('/')} className="text-gray-500 -mt-1 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">
                <Icon name="x" className="w-8 h-8" />
              </button>
            </div>
            {progressPercentage > 0 && (
              <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4 dark:bg-gray-700 mt-4">
                <div className="bg-primary-600 h-2.5 rounded-full" style={{ width: `${progressPercentage}%` }}></div>
              </div>
            )}

            <form onSubmit={(e) => {
              e.preventDefault();
              goNext();
            }}>
              {isCheckingInvite && (
                <div className="flex justify-center items-center mt-10">
                  <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary-500"></div>
                </div>
              )}
              {inviteError.length > 0 && <AlertMessageError message={inviteError} />}
              {!isBlocked && step === 'username' && <UsernameStep defaultUsername={username} inviteCode={inviteCode || undefined} onUsernameChange={setUsername} />}
              {step === 'password' && <PasswordStep termsUrl={termsUrl} agreedToTerms={agreedToTerms} onAgreedToTermsChange={setAgreedToTerms} onPasswordChange={setPassword} />}
              {step === 'creating' && <CreatingStep username={username} password={password} inviteCode={inviteCode || undefined} onDone={onRegistered} />}
              <button type="submit" className="hidden" />
            </form>
          </div>
          <div className="fixed lg:relative bottom-0 left-0 right-0 p-4 bg-gray-100 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 lg:bg-transparent lg:dark:bg-transparent lg:border-0">
            {step === 'password' && password.trim().length > 0 ? (
              <button type="button" onClick={goNext} disabled={!isNextEnabled} className={`w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition duration-300 ease-in-out ${isNextEnabled ? '' : 'opacity-50 cursor-not-allowed'}`}>
                {t('auth.setup.createAccountButton')}
              </button>
            ) : step !== 'creating' && !isBlocked && (
              <button type="button" onClick={goNext} disabled={!isNextEnabled} className={`w-full py-3 px-4 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-lg transition duration-300 ease-in-out ${isNextEnabled ? '' : 'opacity-50 cursor-not-allowed'}`}>
                <ButtonLabel arrow="forward">{t('common.continue')}</ButtonLabel>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Setup;
