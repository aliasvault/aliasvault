import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import AlertMessageError from '@/components/alerts/AlertMessageError';
import LoadingIndicator from '@/components/loading/LoadingIndicator';
import Breadcrumb from '@/components/shared/Breadcrumb';
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
  const tk = 'components.main.pages.settings.security.disable2Fa';
  usePageTitle(t(`${tk}.PageTitle`));
  const [isLoading, setIsLoading] = useState(true);
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
          notifications.addErrorMessage(t(`${tk}.TwoFactorNotEnabled`));
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
   * Switch two-factor off.
   */
  const disableTwoFactor = async (): Promise<void> => {
    try {
      await webApi.post<null, unknown>('TwoFactorAuth/disable', null, false);
      notifications.addSuccessMessage(t(`${tk}.TwoFactorDisabledSuccess`));
      navigate('/settings/security');
    } catch (error) {
      console.error('Failed to disable 2FA:', error);
      notifications.addErrorMessage(t(`${tk}.FailedToDisable2Fa`), true);
    }
  };

  if (isLoading) {
    return <LoadingIndicator />;
  }

  return (
    <>
      <div className="grid grid-cols-1 px-4 pt-6 xl:grid-cols-3 xl:gap-4 dark:bg-gray-900">
        <div className="mb-4 col-span-full xl:mb-2">
          <Breadcrumb items={[{ displayName: t('sharedResources.Home'), url: '/', showHomeIcon: true }, { displayName: t(`${tk}.BreadcrumbSecuritySettings`), url: '/settings/security' }, { displayName: t(`${tk}.BreadcrumbDisable2Fa`) }]} />
          <H1>{t(`${tk}.PageTitle`)}</H1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{t(`${tk}.PageDescription`)}</p>
        </div>
      </div>

      <Card>
        <AlertMessageError hasTopMargin={false} message={t(`${tk}.WarningMessage`)} />
        <div className="mb-3 mt-4 text-sm text-gray-600 dark:text-gray-400">{t(`${tk}.StatusMessage`)}</div>
        <button type="button" onClick={() => void disableTwoFactor()} className="bg-red-500 text-white py-2 px-4 rounded-md hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition duration-150 ease-in-out">
          {t(`${tk}.ConfirmDisableButton`)}
        </button>
      </Card>
    </>
  );
};

export default Disable2Fa;
