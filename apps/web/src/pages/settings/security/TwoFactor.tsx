import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import WarningBox from '@/components/alerts/WarningBox';
import LoadingIndicator from '@/components/loading/LoadingIndicator';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import TwoFactorDisableStep from '@/components/settings/twofactor/TwoFactorDisableStep';
import TwoFactorEnableStep from '@/components/settings/twofactor/TwoFactorEnableStep';
import Button from '@/components/shared/Button';
import Card from '@/components/shared/Card';
import PageContent from '@/components/shared/PageContent';
import StatusPill from '@/components/shared/StatusPill';
import Text from '@/components/shared/Text';
import { useAccountReminders } from '@/context/AccountReminderContext';
import { useWebApi } from '@/context/WebApiContext';
import { usePageTitle } from '@/hooks/usePageTitle';

import type { TwoFactorStatusResponse } from '@aliasvault/models/webapi';

export type TwoFactorPageMode = 'status' | 'enable' | 'disable';

/**
 * Current two-factor status with the action to switch it.
 */
const TwoFactorStatus: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const webApi = useWebApi();
  const { twoFactorReminderDismissed, dismissTwoFactorReminder } = useAccountReminders();
  const [isLoading, setIsLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);

  /**
   * Read the two-factor status from the server.
   */
  const loadData = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    try {
      const status = await webApi.get<TwoFactorStatusResponse>('TwoFactorAuth/status');
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
      {!enabled && !twoFactorReminderDismissed && (
        <WarningBox id="two-factor-warning" icon="exclamation" className="mx-4 mb-4" actions={<Button id="two-factor-warning-dismiss" color="outline" onClick={() => void dismissTwoFactorReminder()}>{t('common.dismiss')}</Button>}>
          <p>{t('settings.securitySettings.twoFactor.notEnabledWarning')}</p>
        </WarningBox>
      )}
      <Card>
        <StatusPill id="two-factor-status" enabled={enabled} size="md" />
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
