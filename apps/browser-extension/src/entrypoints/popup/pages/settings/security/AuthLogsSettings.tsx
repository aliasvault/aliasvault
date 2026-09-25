import { toLocalDisplayFormat } from '@aliasvault/client/utilities/DateFormatter';
import { AuthEventType } from '@aliasvault/models/webapi';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AlertMessage from '@/entrypoints/popup/components/AlertMessage';
import PageTitle from '@/entrypoints/popup/components/PageTitle';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';

import type { AuthLogModel } from '@aliasvault/models/webapi';

/**
 * Recent auth logs page which lists the recent authentication attempts on the account.
 */
const AuthLogsSettings: React.FC = () => {
  const { t } = useTranslation();
  const webApi = useWebApi();
  const { setIsInitialLoading } = useLoading();

  const [logs, setLogs] = useState<AuthLogModel[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadLogs = useCallback(async () : Promise<void> => {
    try {
      setLogs(await webApi.getAuthLogs());
      setError(null);
    } catch {
      setError(t('settings.securitySettings.authLogs.failedToLoad'));
    } finally {
      setIsInitialLoading(false);
    }
  }, [webApi, t, setIsInitialLoading]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  return (
    <div className="space-y-6">
      <div>
        <PageTitle>{t('settings.securitySettings.authLogs.title')}</PageTitle>
        <p className="text-sm text-gray-600 dark:text-gray-400">{t('settings.securitySettings.authLogs.description')}</p>
      </div>

      {error && <AlertMessage type="error" message={error} />}

      <section>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          {logs.length === 0 ? (
            <p className="p-4 text-sm text-gray-500 dark:text-gray-400">{t('settings.securitySettings.authLogs.noLogs')}</p>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {logs.map((log) => (
                <div key={log.id} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-gray-900 dark:text-white break-words">{AuthEventType[log.eventType] ?? log.eventType}</p>
                    <span className={`shrink-0 text-sm font-semibold ${log.isSuccess ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {log.isSuccess ? t('settings.securitySettings.authLogs.success') : t('settings.securitySettings.authLogs.failed')}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {t('settings.securitySettings.authLogs.time')}: {toLocalDisplayFormat(log.timestamp)}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t('settings.securitySettings.authLogs.ipAddress')}: {log.ipAddress}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 break-words">
                    {t('settings.securitySettings.authLogs.client')}: {log.client}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default AuthLogsSettings;
