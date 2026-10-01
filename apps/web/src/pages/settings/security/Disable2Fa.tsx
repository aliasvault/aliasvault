import { apiErrorMessage } from '@aliasvault/client/api/errors/ApiErrorMessage';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import AlertMessageError from '@/components/alerts/AlertMessageError';
import LoadingIndicator from '@/components/loading/LoadingIndicator';
import Breadcrumb from '@/components/shared/Breadcrumb';
import Button from '@/components/shared/Button';
import Card from '@/components/shared/Card';
import H1 from '@/components/shared/H1';
import { useNotifications } from '@/context/NotificationContext';
import { useWebApi } from '@/context/WebApiContext';
import { usePageTitle } from '@/hooks/usePageTitle';

/**
 * The disable two-factor authentication page.
 */
const Disable2Fa: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const webApi = useWebApi();
  const notifications = useNotifications();
  
  usePageTitle(t('settings.securitySettings.disable2fa.pageTitle'));
  const [isLoading, setIsLoading] = useState(true);
  const [code, setCode] = useState('');
  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current) {
      return;
    }
    hasStarted.current = true;

    /**
     * Only show the page when two-factor is actually on.
     */
    const check = async (): Promise<void> => {
      try {
        const status = await webApi.get<{ twoFactorEnabled: boolean }>('TwoFactorAuth/status');
        if (!status.twoFactorEnabled) {
          notifications.addErrorMessage(t('settings.securitySettings.disable2fa.twoFactorNotEnabled'));
          navigate('/settings/security');
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
      navigate('/settings/security');
    } catch (error) {
      console.error('Failed to disable 2FA:', error);
      notifications.addErrorMessage(apiErrorMessage(error, t, t('settings.securitySettings.disable2fa.failedToDisable2Fa')), true);
    }
  };

  if (isLoading) {
    return <LoadingIndicator />;
  }

  return (
    <>
      <div className="grid grid-cols-1 px-4 pt-6 xl:grid-cols-3 xl:gap-4 dark:bg-gray-900">
        <div className="mb-4 col-span-full xl:mb-2">
          <Breadcrumb items={[{ displayName: t('common.home'), url: '/', showHomeIcon: true }, { displayName: t('settings.securitySettings.pageTitle'), url: '/settings/security' }, { displayName: t('settings.securitySettings.disable2fa.pageTitle') }]} />
          <H1>{t('settings.securitySettings.disable2fa.pageTitle')}</H1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{t('settings.securitySettings.disable2fa.pageDescription')}</p>
        </div>
      </div>

      <Card>
        <AlertMessageError hasTopMargin={false} message={t('settings.securitySettings.disable2fa.warningMessage')} />
        <div className="mb-3 mt-4 text-sm text-gray-600 dark:text-gray-400">{t('settings.securitySettings.disable2fa.statusMessage')}</div>
        <form onSubmit={disableTwoFactor} className="space-y-4" av-enable="true" av-suppress-save="true">
          <input id="disableCode" type="text" value={code} onChange={e => setCode(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400" placeholder={t('settings.securitySettings.enable2fa.verificationCodePlaceholder')} autoComplete="one-time-code" required />
          <Button type="submit" color="danger">{t('settings.securitySettings.disable2fa.confirmDisableButton')}</Button>
        </form>
      </Card>
    </>
  );
};

export default Disable2Fa;
