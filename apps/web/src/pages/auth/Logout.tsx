import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import BoldLoadingIndicator from '@/components/loading/BoldLoadingIndicator';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { WebAuthnService } from '@/utils/WebAuthnService';

/**
 * Logs the user out and returns to the start page.
 */
const Logout: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const auth = useAuth();
  const notifications = useNotifications();
  const hasStarted = useRef(false);
  usePageTitle(t('pages.auth.logout.LoggingOutTitle'));

  useEffect(() => {
    if (hasStarted.current) {
      return;
    }
    hasStarted.current = true;

    /**
     * Revoke the tokens and redirect to the start page.
     */
    const run = async (): Promise<void> => {
      WebAuthnService.disable();
      await auth.logout({ userInitiated: true });
      notifications.clearMessages();
      await new Promise(resolve => setTimeout(resolve, 500));
      navigate('/', { replace: true });
    };
    void run();
  }, [auth, notifications, navigate]);

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center px-6 pt-8 pb-8 h-full w-full">
      <div className="relative p-6 sm:p-8 bg-white dark:bg-gray-700 rounded-lg sm:shadow-xl max-w-md w-full mx-auto">
        <div className="text-center">
          <div className="space-y-4">
            <BoldLoadingIndicator />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{t('pages.auth.logout.LoggingOutTitle')}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('pages.auth.logout.LoggingOutDescription')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Logout;
