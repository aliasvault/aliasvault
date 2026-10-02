import { apiErrorMessage } from '@aliasvault/client/api/errors/ApiErrorMessage';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import LoadingIndicator from '@/components/loading/LoadingIndicator';
import Button from '@/components/shared/Button';
import Card from '@/components/shared/Card';
import InputTextField from '@/components/shared/InputTextField';
import SectionTitle from '@/components/shared/SectionTitle';
import { useAccountNudges } from '@/context/AccountNudgeContext';
import { useNotifications } from '@/context/NotificationContext';
import { useWebApi } from '@/context/WebApiContext';

/**
 * Disable step of the two-factor page: confirm with an authenticator or recovery code.
 */
const TwoFactorDisableStep: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const webApi = useWebApi();
  const notifications = useNotifications();
  const { refresh: refreshNudges } = useAccountNudges();
  const [isLoading, setIsLoading] = useState(true);
  const [code, setCode] = useState('');
  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current) {
      return;
    }
    hasStarted.current = true;

    /**
     * Only show the step when two-factor is actually on.
     */
    const check = async (): Promise<void> => {
      try {
        const status = await webApi.get<{ twoFactorEnabled: boolean }>('TwoFactorAuth/status');
        if (!status.twoFactorEnabled) {
          notifications.addErrorMessage(t('settings.securitySettings.disable2fa.twoFactorNotEnabled'));
          navigate('/settings/two-factor');
          return;
        }
      } catch (error) {
        console.error('Failed to read 2FA status:', error);
      }
      setIsLoading(false);
    };
    void check();
  }, [navigate, notifications, t, webApi]);

  /**
   * Switch two-factor off after the server checked the authenticator or recovery code.
   */
  const disableTwoFactor = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      await webApi.post<string, unknown>('TwoFactorAuth/disable', code.trim(), false);
      notifications.addSuccessMessage(t('settings.securitySettings.disable2fa.twoFactorDisabledSuccess'));
      void refreshNudges();
      navigate('/settings/two-factor');
    } catch (error) {
      console.error('Failed to disable 2FA:', error);
      notifications.addErrorMessage(apiErrorMessage(error, t, t('settings.securitySettings.disable2fa.failedToDisable2Fa')), true);
    }
  };

  if (isLoading) {
    return <LoadingIndicator />;
  }

  return (
    <Card>
      <SectionTitle className="mb-4">{t('settings.securitySettings.disable2fa.pageTitle')}</SectionTitle>
      <form onSubmit={disableTwoFactor} className="space-y-3 max-w-sm" av-enable="true" av-suppress-save="true">
        <InputTextField id="disableCode" value={code} onValueChange={setCode} placeholder={t('settings.securitySettings.enable2fa.verificationCodePlaceholder')} autoComplete="one-time-code" required />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" color="danger">{t('settings.securitySettings.disable2fa.confirmDisableButton')}</Button>
          <Button color="outline" onClick={() => navigate('/settings/two-factor')}>{t('common.cancel')}</Button>
        </div>
      </form>
    </Card>
  );
};

export default TwoFactorDisableStep;
