import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import ActiveSessionsSection from '@/components/settings/security/ActiveSessionsSection';
import DeleteAccountSection from '@/components/settings/security/DeleteAccountSection';
import PasswordChangeSection from '@/components/settings/security/PasswordChangeSection';
import QuickVaultUnlockSection from '@/components/settings/security/QuickVaultUnlockSection';
import RecentAuthLogsSection from '@/components/settings/security/RecentAuthLogsSection';
import type { SectionHandle } from '@/components/settings/security/SecuritySection';
import TwoFactorAuthenticationSection from '@/components/settings/security/TwoFactorAuthenticationSection';
import PageContent from '@/components/shared/PageContent';
import PageHeader from '@/components/shared/PageHeader';
import RefreshButton from '@/components/shared/RefreshButton';
import { usePageTitle } from '@/hooks/usePageTitle';

/**
 * The security settings page.
 */
const SecuritySettings: React.FC = () => {
  const { t } = useTranslation();
  
  usePageTitle(t('settings.securitySettings.pageTitle'));
  const twoFactorRef = useRef<SectionHandle>(null);
  const quickUnlockRef = useRef<SectionHandle>(null);
  const sessionsRef = useRef<SectionHandle>(null);
  const authLogsRef = useRef<SectionHandle>(null);

  /**
   * Reload every section at once.
   */
  const loadData = useCallback(async (): Promise<void> => {
    await Promise.all([twoFactorRef.current?.loadData(), quickUnlockRef.current?.loadData(), sessionsRef.current?.loadData(), authLogsRef.current?.loadData()]);
  }, []);

  useEffect(() => void loadData(), [loadData]);

  return (
    <>
      <PageHeader breadcrumbItems={[{ displayName: t('settings.securitySettings.pageTitle') }]} title={t('settings.securitySettings.pageTitle')} description={t('settings.securitySettings.pageDescription')} customActions={<RefreshButton onClick={() => void loadData()} buttonText={t('common.refresh')} />} />

      <PageContent>
        <PasswordChangeSection />
        <TwoFactorAuthenticationSection ref={twoFactorRef} />
        <QuickVaultUnlockSection ref={quickUnlockRef} />
        <ActiveSessionsSection ref={sessionsRef} onSessionsChanged={loadData} />
        <RecentAuthLogsSection ref={authLogsRef} />
        <DeleteAccountSection />
      </PageContent>
    </>
  );
};

export default SecuritySettings;
