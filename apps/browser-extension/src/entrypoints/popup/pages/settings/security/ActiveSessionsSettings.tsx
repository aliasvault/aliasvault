import { toLocalDisplayFormat } from '@aliasvault/client/utilities/DateFormatter';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AlertMessage from '@/entrypoints/popup/components/AlertMessage';
import ConfirmDeleteModal from '@/entrypoints/popup/components/Dialogs/ConfirmDeleteModal';
import PageTitle from '@/entrypoints/popup/components/PageTitle';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';

import type { RefreshToken } from '@aliasvault/models/webapi';

/**
 * Active sessions page which lists the devices that are currently logged in and allows revoking them.
 */
const ActiveSessionsSettings: React.FC = () => {
  const { t } = useTranslation();
  const webApi = useWebApi();
  const { setIsInitialLoading } = useLoading();

  const [sessions, setSessions] = useState<RefreshToken[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<RefreshToken | null>(null);

  const loadSessions = useCallback(async () : Promise<void> => {
    try {
      setSessions(await webApi.getActiveSessions());
      setError(null);
    } catch {
      setError(t('settings.securitySettings.activeSessions.failedToLoad'));
    } finally {
      setIsInitialLoading(false);
    }
  }, [webApi, t, setIsInitialLoading]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  /**
   * Revoke the session the confirmation dialog is about.
   */
  const handleRevoke = async () : Promise<void> => {
    const session = pendingRevoke;
    setPendingRevoke(null);

    if (!session) {
      return;
    }

    setError(null);
    setNotice(null);

    try {
      await webApi.revokeSession(session.id);
      setNotice(t('settings.securitySettings.activeSessions.sessionRevoked'));
    } catch {
      setError(t('settings.securitySettings.activeSessions.failedToRevoke'));
    }

    await loadSessions();
  };

  return (
    <>
      <ConfirmDeleteModal
        isOpen={pendingRevoke !== null}
        onClose={() => setPendingRevoke(null)}
        onConfirm={handleRevoke}
        title={t('settings.securitySettings.activeSessions.revokeSession')}
        message={t('settings.securitySettings.activeSessions.revokeConfirmation')}
        confirmText={t('settings.securitySettings.activeSessions.revoke')}
      />

      <div className="space-y-6">
        <div>
          <PageTitle>{t('settings.securitySettings.activeSessions.title')}</PageTitle>
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('settings.securitySettings.activeSessions.description')}</p>
        </div>

        {error && <AlertMessage type="error" message={error} />}
        {notice && <AlertMessage type="success" message={notice} />}

        <section>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            {sessions.length === 0 ? (
              <p className="p-4 text-sm text-gray-500 dark:text-gray-400">{t('settings.securitySettings.activeSessions.noSessions')}</p>
            ) : (
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {sessions.map((session) => (
                  <div key={session.id} className="p-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 dark:text-white break-words">{session.deviceIdentifier}</p>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        {t('settings.securitySettings.activeSessions.lastActive')}: {toLocalDisplayFormat(session.createdAt)}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {t('settings.securitySettings.activeSessions.expires')}: {toLocalDisplayFormat(session.expireDate)}
                      </p>
                    </div>
                    <button
                      onClick={() => setPendingRevoke(session)}
                      className="shrink-0 px-3 py-1.5 text-sm bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 rounded-md transition-colors"
                    >
                      {t('settings.securitySettings.activeSessions.revoke')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
};

export default ActiveSessionsSettings;
