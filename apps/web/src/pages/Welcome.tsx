import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { ButtonLabel } from '@/components/shared/Button';
import Icon from '@/components/shared/Icon';
import { useDb } from '@/context/DbContext';
import { useLoading } from '@/context/LoadingContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVaultMutate } from '@/hooks/useVaultMutate';
import { type AppInfo, BROWSER_EXTENSIONS, MOBILE_APPS } from '@/utils/AppDownloads';

/** The tutorial steps, in order. */
const STEPS = ['welcome', 'howAliasVaultWorks', 'tips', 'createFirstIdentity'] as const;
type TutorialStep = typeof STEPS[number];

/**
 * A download tile for one browser extension or mobile app.
 */
const AppTile: React.FC<{ app: AppInfo; unavailableLabel: string }> = ({ app, unavailableLabel }) => (app.isAvailable ? (
  <a href={app.downloadUrl} target="_blank" rel="noreferrer" className="flex flex-col items-center p-3 rounded-lg bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors">
    <img src={app.iconPath} alt={app.name} className="w-8 h-8 mb-2" />
    <span className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300">{app.name}</span>
  </a>
) : (
  <div className="flex flex-col items-center p-3 rounded-lg bg-gray-200 dark:bg-gray-600">
    <img src={app.iconPath} alt={app.name} className="w-8 h-8 mb-2 opacity-50" />
    <span className="text-xs text-gray-500 dark:text-gray-400">{unavailableLabel}</span>
  </div>
));

/**
 * The tutorial shown to a new user with an empty vault, right after creating the account.
 */
const Welcome: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dbContext = useDb();
  const { showLoading, hideLoading } = useLoading();
  const { executeVaultMutationInBackground } = useVaultMutate();
  
  usePageTitle(t('web.welcome.tutorialStepTitle'));

  const [step, setStep] = useState<TutorialStep>('welcome');
  const stepIndex = STEPS.indexOf(step);
  const progressPercentage = Math.floor(stepIndex * 100 / (STEPS.length - 1));

  useEffect(() => {
    if (dbContext.sqliteClient?.settings.getSetting('TutorialDone', 'False').toLowerCase() === 'true') {
      navigate('/', { replace: true });
    }
  }, [dbContext.sqliteClient, navigate]);

  /**
   * The title of a step.
   */
  const stepTitle = (): string => {
    switch (step) {
      case 'welcome': return t('items.welcomeTitle');
      case 'howAliasVaultWorks': return t('web.welcome.howAliasVaultWorksStepTitle');
      case 'tips': return t('web.welcome.tipsStepTitle');
      default: return t('web.welcome.getStartedButton');
    }
  };

  /**
   * One step forward.
   */
  const goNext = (): void => {
    setStep(STEPS[Math.min(stepIndex + 1, STEPS.length - 1)]);
    window.scrollTo({ top: 0 });
  };

  /**
   * Mark the tutorial as done in the vault and continue to the items page.
   */
  const finishTutorial = async (): Promise<void> => {
    const client = dbContext.sqliteClient;
    if (!client) {
      return;
    }
    showLoading(t('web.welcome.finishingTutorialMessage'));
    try {
      await executeVaultMutationInBackground(async () => {
        client.settings.updateSetting('TutorialDone', 'True');
      });
      navigate('/items');
    } catch (error) {
      console.error('[Welcome] Failed to finish the tutorial:', error);
    } finally {
      hideLoading();
    }
  };

  return (
    <div className="bg-gray-100 dark:bg-gray-900 flex flex-col lg:items-center lg:justify-center pb-16">
      <div className="w-full mt-4 lg:mt-16 mx-auto lg:max-w-4xl lg:bg-white lg:dark:bg-gray-800 lg:shadow-xl lg:rounded-lg lg:overflow-hidden flex flex-col">
        <div className="flex flex-col flex-grow">
          <div className="flex-grow p-6 pt-4 lg:pt-6 lg:pb-4">
            <div className="flex justify-between items-center mb-4">
              <div className="flex-grow text-center">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{stepTitle()}</h2>
              </div>
            </div>

            {progressPercentage > 0 && (
              <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4 dark:bg-gray-700 mt-4">
                <div className="bg-primary-600 h-2.5 rounded-full" style={{ width: `${progressPercentage}%` }}></div>
              </div>
            )}

            {step === 'welcome' && (
              <div className="space-y-4">
                <p className="flex items-start gap-2 text-gray-600 dark:text-gray-400">
                  <Icon name="check" className="w-5 h-5 mt-0.5 flex-shrink-0 text-green-600 dark:text-green-400" />
                  <span>{t('web.welcome.welcomeMessage')}</span>
                </p>
              </div>
            )}

            {step === 'howAliasVaultWorks' && (
              <div className="space-y-4">
                <p className="text-gray-600 dark:text-gray-400">{t('web.welcome.howItWorksIntro')}</p>
                <ol className="list-decimal list-inside space-y-2 text-gray-600 dark:text-gray-400">
                  <li>{t('web.welcome.howItWorksStep1')}</li>
                  <li>{t('web.welcome.howItWorksStep2')}</li>
                  <li>{t('web.welcome.howItWorksStep3')}</li>
                  <li>{t('web.welcome.howItWorksStep4')}</li>
                </ol>
              </div>
            )}

            {step === 'tips' && (
              <div className="space-y-4">
                <div className="space-y-3">
                  <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <h4 className="font-semibold text-gray-900 dark:text-white">{t('web.welcome.masterPasswordTipTitle')}</h4>
                    <p className="text-gray-600 dark:text-gray-400">{t('web.welcome.masterPasswordTipContent')}</p>
                  </div>
                  <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <h4 className="font-semibold text-gray-900 dark:text-white">{t('web.welcome.twoFactorTipTitle')}</h4>
                    <p className="text-gray-600 dark:text-gray-400">{t('web.welcome.twoFactorTipContent')}</p>
                  </div>
                  <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <h4 className="font-semibold text-gray-900 dark:text-white">{t('web.welcome.extensionsAppsTipTitle')}</h4>
                    <p className="text-gray-600 dark:text-gray-400 mb-4">{t('web.welcome.extensionsAppsTipContent')}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                      {BROWSER_EXTENSIONS.map(app => <AppTile key={app.name} app={app} unavailableLabel={t('settings.apps.comingSoonText')} />)}
                      {MOBILE_APPS.map(app => <AppTile key={app.name} app={app} unavailableLabel={`${app.name} ${t('web.welcome.soonSuffix')}`} />)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {step === 'createFirstIdentity' && (
              <div className="space-y-4">
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">{t('web.welcome.readyToStartTitle')}</h3>
                <p className="text-gray-600 dark:text-gray-400">{t('web.welcome.readyToStartMessage')}</p>
                <div className="mt-4">
                  <button type="button" onClick={() => navigate('/items/create')} className="w-full bg-primary-600 hover:bg-primary-700 text-white font-semibold py-3 px-4 rounded-lg transition duration-300">
                    {t('web.welcome.createFirstIdentityButton')}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="fixed lg:relative bottom-0 left-0 right-0 p-4 bg-gray-100 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 lg:bg-transparent lg:dark:bg-transparent lg:border-0">
            {step !== 'tips' ? (
              <button type="button" onClick={goNext} className="w-full py-3 px-4 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-lg transition duration-300">
                <ButtonLabel arrow="forward">{t('common.continue')}</ButtonLabel>
              </button>
            ) : (
              <button type="button" onClick={() => void finishTutorial()} className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition duration-300">
                {t('web.welcome.getStartedButton')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Welcome;
