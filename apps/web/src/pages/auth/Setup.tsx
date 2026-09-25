import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import LanguageSwitcher from '@/components/auth/LanguageSwitcher';
import { CreatingStep, PasswordStep, TermsAndConditionsStep, UsernameStep } from '@/components/auth/setup/SetupSteps';
import { getAppConfig } from '@/config/AppConfig';
import { usePageTitle } from '@/hooks/usePageTitle';

/** The wizard steps, in order. */
const STEPS = ['terms', 'username', 'password', 'creating'] as const;
type SetupStep = typeof STEPS[number];

/**
 * The create vault wizard: terms, username, password, then registration.
 */
const Setup: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const tk = 'pages.auth.setup.setup';
  usePageTitle(t(`${tk}.SetupStepTitle`));

  const [step, setStep] = useState<SetupStep>('terms');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!getAppConfig().publicRegistrationEnabled) {
      navigate('/user/login', { replace: true });
    }
  }, [navigate]);

  const isNextEnabled = step === 'terms' ? agreedToTerms : step === 'username' ? username.trim().length > 0 : step === 'password' ? password.trim().length > 0 : false;
  const stepIndex = STEPS.indexOf(step);
  const progressPercentage = Math.floor(stepIndex * 100 / (STEPS.length - 1));

  /**
   * The title of a step.
   */
  const stepTitle = (): string => {
    switch (step) {
      case 'terms': return t(`${tk}.TermsAndConditionsStepTitle`);
      case 'username': return t(`${tk}.UsernameStepTitle`);
      case 'password': return t(`${tk}.PasswordStepTitle`);
      default: return t(`${tk}.CreatingStepTitle`);
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

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex flex-col lg:items-center lg:justify-center">
      <div className="absolute top-4 right-4 z-10 mt-16 lg:mt-0 hidden lg:block">
        <LanguageSwitcher />
      </div>
      <div className="w-full mx-auto lg:max-w-xl lg:bg-white lg:dark:bg-gray-800 lg:shadow-xl lg:rounded-lg lg:overflow-hidden flex flex-col">
        <div className="flex flex-col flex-grow">
          <div className="flex-grow p-6 pt-4 lg:pt-6 pb-28 lg:pb-4">
            <div className="flex justify-between items-center mb-4">
              <div>
                <button type="button" onClick={goBack} className={`text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 ${step === 'terms' ? 'invisible' : ''}`}>
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
                  </svg>
                </button>
              </div>
              <div className="flex-grow text-center">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{stepTitle()}</h2>
              </div>
              <button type="button" onClick={() => navigate('/')} className="text-gray-500 -mt-1 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
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
              {step === 'terms' && <TermsAndConditionsStep agreedToTerms={agreedToTerms} onAgreedToTermsChange={setAgreedToTerms} />}
              {step === 'username' && <UsernameStep defaultUsername={username} onUsernameChange={setUsername} />}
              {step === 'password' && <PasswordStep onPasswordChange={setPassword} />}
              {step === 'creating' && <CreatingStep username={username} password={password} onDone={onRegistered} />}
              <button type="submit" className="hidden" />
            </form>
          </div>
          <div className="fixed lg:relative bottom-0 left-0 right-0 p-4 bg-gray-100 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 lg:bg-transparent lg:dark:bg-transparent lg:border-0">
            {step === 'password' && password.trim().length > 0 ? (
              <button type="button" onClick={goNext} className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition duration-300 ease-in-out">
                {t(`${tk}.CreateAccountButton`)}
              </button>
            ) : step !== 'creating' && (
              <button type="button" onClick={goNext} disabled={!isNextEnabled} className={`w-full py-3 px-4 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-lg transition duration-300 ease-in-out ${isNextEnabled ? '' : 'opacity-50 cursor-not-allowed'}`}>
                {t(`${tk}.ContinueButton`)}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Setup;
