import { AuthEventType } from '@aliasvault/models/webapi';
import React, { useCallback, useImperativeHandle, useState, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

import LoadingIndicator from '@/components/loading/LoadingIndicator';
import SecuritySection, { formatDateTime, type SectionHandle } from '@/components/settings/security/SecuritySection';
import StatusPill from '@/components/shared/StatusPill';
import { useWebApi } from '@/context/WebApiContext';

import type { AuthLogModel } from '@aliasvault/models/webapi';

/** Auth logs shown, newest first. */
const MAX_AUTH_LOGS = 20;

/**
 * The latest login attempts.
 */
const RecentAuthLogsSection = forwardRef<SectionHandle>((_, ref) => {
  const { t } = useTranslation();
  const webApi = useWebApi();
  const [isLoading, setIsLoading] = useState(true);
  const [logs, setLogs] = useState<AuthLogModel[]>([]);
  const tk = 'components.main.settings.security.recentAuthLogsSection';

  const loadData = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    try {
      const all = await webApi.getAuthLogs();
      setLogs([...all].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, MAX_AUTH_LOGS));
    } finally {
      setIsLoading(false);
    }
  }, [webApi]);
  useImperativeHandle(ref, () => ({ loadData }), [loadData]);

  return (
    <SecuritySection title={t(`${tk}.Title`)}>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{t(`${tk}.Description`)}</p>
      {isLoading ? <LoadingIndicator /> : logs.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">{t(`${tk}.NoLogsMessage`)}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400">
            <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-700 dark:text-gray-400">
              <tr>
                <th scope="col" className="px-6 py-3">{t(`${tk}.TimestampColumn`)}</th>
                <th scope="col" className="px-6 py-3">{t(`${tk}.EventTypeColumn`)}</th>
                <th scope="col" className="px-6 py-3">{t(`${tk}.ClientColumn`)}</th>
                <th scope="col" className="px-6 py-3">{t(`${tk}.IpAddressColumn`)}</th>
                <th scope="col" className="px-6 py-3">{t(`${tk}.SuccessColumn`)}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} className="bg-white border-b dark:bg-gray-800 dark:border-gray-700">
                  <td className="px-6 py-4">{formatDateTime(log.timestamp)}</td>
                  <td className="px-6 py-4">{AuthEventType[log.eventType] ?? log.eventType}</td>
                  <td className="px-6 py-4">{log.client}</td>
                  <td className="px-6 py-4">{log.ipAddress}</td>
                  <td className="px-4 py-4"><StatusPill enabled={log.isSuccess} textTrue={t(`${tk}.SuccessStatus`)} textFalse={t(`${tk}.FailedStatus`)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SecuritySection>
  );
});
RecentAuthLogsSection.displayName = 'RecentAuthLogsSection';

export default RecentAuthLogsSection;
