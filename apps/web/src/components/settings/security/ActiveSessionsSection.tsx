import React, { useCallback, useImperativeHandle, useState, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

import LoadingIndicator from '@/components/loading/LoadingIndicator';
import SecuritySection, { formatDateTime, type SectionHandle } from '@/components/settings/security/SecuritySection';
import Button from '@/components/shared/Button';
import { useNotifications } from '@/context/NotificationContext';
import { useWebApi } from '@/context/WebApiContext';

import type { RefreshToken } from '@aliasvault/models/webapi';

/**
 * The devices with an active session, each revocable.
 */
const ActiveSessionsSection = forwardRef<SectionHandle, { onSessionsChanged: () => Promise<void> }>(({ onSessionsChanged }, ref) => {
  const { t } = useTranslation();
  const webApi = useWebApi();
  const notifications = useNotifications();
  const [isLoading, setIsLoading] = useState(true);
  const [sessions, setSessions] = useState<RefreshToken[]>([]);

  const loadData = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    try {
      setSessions(await webApi.getActiveSessions());
    } finally {
      setIsLoading(false);
    }
  }, [webApi]);
  useImperativeHandle(ref, () => ({ loadData }), [loadData]);

  /**
   * Revoke a session.
   */
  const revokeSession = async (id: string): Promise<void> => {
    try {
      await webApi.revokeSession(id);
      notifications.addSuccessMessage(t('settings.securitySettings.activeSessions.revokeSuccessMessage'), true);
      await onSessionsChanged();
    } catch (error) {
      notifications.addErrorMessage(t('settings.securitySettings.activeSessions.revokeExceptionMessage', { error: error instanceof Error ? error.message : String(error) }), true);
    }
  };

  return (
    <SecuritySection title={t('settings.securitySettings.activeSessionsTitle')}>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{t('settings.securitySettings.activeSessions.headerText')}</p>
      {isLoading ? <LoadingIndicator /> : sessions.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">{t('settings.securitySettings.activeSessions.noSessionsMessage')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400">
            <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-700 dark:text-gray-400">
              <tr>
                <th scope="col" className="px-6 py-3">{t('settings.securitySettings.authLogs.deviceColumn')}</th>
                <th scope="col" className="px-6 py-3">{t('settings.securitySettings.activeSessions.lastActive')}</th>
                <th scope="col" className="px-6 py-3">{t('settings.securitySettings.activeSessions.expires')}</th>
                <th scope="col" className="px-6 py-3">{t('settings.securitySettings.activeSessions.actionColumn')}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map(session => (
                <tr key={session.id} className="bg-white border-b dark:bg-gray-800 dark:border-gray-700">
                  <td className="px-6 py-4">{session.deviceIdentifier}</td>
                  <td className="px-6 py-4">{formatDateTime(session.createdAt)}</td>
                  <td className="px-6 py-4">{formatDateTime(session.expireDate)}</td>
                  <td className="px-6 py-4"><Button color="danger" onClick={() => void revokeSession(session.id)}>{t('settings.securitySettings.activeSessions.revoke')}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SecuritySection>
  );
});
ActiveSessionsSection.displayName = 'ActiveSessionsSection';

export default ActiveSessionsSection;
