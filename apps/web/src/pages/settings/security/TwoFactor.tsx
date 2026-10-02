import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import LoadingIndicator from '@/components/loading/LoadingIndicator';
import SettingsIcon from '@/components/settings/SettingsIcon';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import TwoFactorDisableStep from '@/components/settings/twofactor/TwoFactorDisableStep';
import TwoFactorEnableStep from '@/components/settings/twofactor/TwoFactorEnableStep';
import Button from '@/components/shared/Button';
import Card from '@/components/shared/Card';
import PageContent from '@/components/shared/PageContent';
import Text from '@/components/shared/Text';
import { useWebApi } from '@/context/WebApiContext';
import { usePageTitle } from '@/hooks/usePageTitle';

export type TwoFactorPageMode = 'status' | 'enable' | 'disable';

/**
 * Current two-factor status with the action to switch it.
 */
const TwoFactorStatus: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const webApi = useWebApi();
  const [isLoading, setIsLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);

  /**
   * Read the two-factor status from the server.
   */
  const loadData = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    try {
      const status = await webApi.get<{ twoFactorEnabled: boolean }>('TwoFactorAuth/status');
      setEnabled(status.twoFactorEnabled);
    } finally {
      setIsLoading(false);
    }
  }, [webApi]);

  useEffect(() => void loadData(), [loadData]);

  if (isLoading) {
    return <LoadingIndicator />;
  }

  return (
    <>
      {!enabled && (
        <div id="two-factor-warning" role="alert" className="flex items-start gap-3 mx-4 mb-4 p-4 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
          <span className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400">
            <SettingsIcon name="warning" className="w-5 h-5" />
          </span>
          <p className="text-sm pt-1.5">{t('settings.securitySettings.twoFactor.notEnabledWarning')}</p>
        </div>
      )}
      <Card>
        <span id="two-factor-status" className={`inline-flex items-center px-2.5 py-0.5 text-sm font-semibold rounded-full ${enabled ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300'}`}>
          {enabled ? t('common.enabled') : t('common.disabled')}
        </span>
        <Text className="mt-3 mb-5">
          {enabled ? t('settings.securitySettings.twoFactor.enabledMessage') : t('settings.securitySettings.twoFactor.disabledMessage')}
        </Text>
        {enabled ? (
          <Button color="danger" onClick={() => navigate('/settings/two-factor/disable')}>{t('settings.securitySettings.disable2fa.pageTitle')}</Button>
        ) : (
          <Button color="success" onClick={() => navigate('/settings/two-factor/enable')}>{t('settings.securitySettings.enable2fa.pageTitle')}</Button>
        )}
      </Card>
    </>
  );
};

/**
 * The two-factor authentication page. The enable and disable steps render below the same header,
 * with the back button returning to the status.
 */
const TwoFactor: React.FC<{ mode?: TwoFactorPageMode }> = ({ mode = 'status' }) => {
  const { t } = useTranslation();
  const title = t('common.twoFactorAuthentication');
  const stepTitle = mode === 'enable' ? t('settings.securitySettings.enable2fa.pageTitle') : t('settings.securitySettings.disable2fa.pageTitle');
  const description = mode === 'enable' ? t('settings.securitySettings.enable2fa.pageDescription') : mode === 'disable' ? t('settings.securitySettings.disable2fa.pageDescription') : t('web.welcome.twoFactorTipContent');

  usePageTitle(mode === 'status' ? title : stepTitle);

  return (
    <>
      {mode === 'status' ? (
        <SettingsPageHeader icon="twoFactor" title={title} description={description} />
      ) : (
        <SettingsPageHeader icon="twoFactor" title={title} description={description} backTo={{ url: '/settings/two-factor', label: title }} />
      )}

      <PageContent>
        {mode === 'enable' ? <TwoFactorEnableStep /> : mode === 'disable' ? <TwoFactorDisableStep /> : <TwoFactorStatus />}
      </PageContent>
    </>
  );
};

export default TwoFactor;
