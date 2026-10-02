import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import ActiveSessionsSection from '@/components/settings/security/ActiveSessionsSection';
import RecentAuthLogsSection from '@/components/settings/security/RecentAuthLogsSection';
import type { SectionHandle } from '@/components/settings/security/SecuritySection';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import PageContent from '@/components/shared/PageContent';
import RefreshButton from '@/components/shared/RefreshButton';
import { usePageTitle } from '@/hooks/usePageTitle';

/**
 * Active sessions and recent login attempts of the account.
 */
const SessionsAndLogs: React.FC = () => {
  const { t } = useTranslation();

  usePageTitle(t('settings.sessionsAndLogs'));
  const sessionsRef = useRef<SectionHandle>(null);
  const authLogsRef = useRef<SectionHandle>(null);

  /**
   * Reload both sections at once.
   */
  const loadData = useCallback(async (): Promise<void> => {
    await Promise.all([sessionsRef.current?.loadData(), authLogsRef.current?.loadData()]);
  }, []);

  useEffect(() => void loadData(), [loadData]);

  return (
    <>
      <SettingsPageHeader icon="sessions" title={t('settings.sessionsAndLogs')} customActions={<RefreshButton onClick={() => void loadData()} buttonText={t('common.refresh')} />} />

      <PageContent>
        <ActiveSessionsSection ref={sessionsRef} onSessionsChanged={loadData} />
        <RecentAuthLogsSection ref={authLogsRef} />
      </PageContent>
    </>
  );
};

export default SessionsAndLogs;
