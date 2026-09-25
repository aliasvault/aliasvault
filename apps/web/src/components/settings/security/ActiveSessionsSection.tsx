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
  const tk = 'components.main.settings.security.activeSessionsSection';

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
      notifications.addSuccessMessage(t(`${tk}.RevokeSuccessMessage`), true);
      await onSessionsChanged();
    } catch (error) {
      notifications.addErrorMessage(t(`${tk}.RevokeExceptionMessage`, { 0: error instanceof Error ? error.message : String(error) }), true);
    }
  };

  return (
    <SecuritySection title={t(`${tk}.Title`)}>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{t(`${tk}.Description`)}</p>
      {isLoading ? <LoadingIndicator /> : sessions.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">{t(`${tk}.NoSessionsMessage`)}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400">
            <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-700 dark:text-gray-400">
              <tr>
                <th scope="col" className="px-6 py-3">{t(`${tk}.DeviceColumn`)}</th>
                <th scope="col" className="px-6 py-3">{t(`${tk}.LastActiveColumn`)}</th>
                <th scope="col" className="px-6 py-3">{t(`${tk}.ExpiresColumn`)}</th>
                <th scope="col" className="px-6 py-3">{t(`${tk}.ActionColumn`)}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map(session => (
                <tr key={session.id} className="bg-white border-b dark:bg-gray-800 dark:border-gray-700">
                  <td className="px-6 py-4">{session.deviceIdentifier}</td>
                  <td className="px-6 py-4">{formatDateTime(session.createdAt)}</td>
                  <td className="px-6 py-4">{formatDateTime(session.expireDate)}</td>
                  <td className="px-6 py-4"><Button color="danger" onClick={() => void revokeSession(session.id)}>{t(`${tk}.RevokeButton`)}</Button></td>
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
