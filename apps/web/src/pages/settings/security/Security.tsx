import React from 'react';
import { useTranslation } from 'react-i18next';

import ClipboardClearSection from '@/components/settings/security/ClipboardClearSection';
import DeleteAccountSection from '@/components/settings/security/DeleteAccountSection';
import PasswordChangeSection from '@/components/settings/security/PasswordChangeSection';
import QuickVaultUnlockSection from '@/components/settings/security/QuickVaultUnlockSection';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import PageContent from '@/components/shared/PageContent';
import { usePageTitle } from '@/hooks/usePageTitle';

/**
 * The security settings page.
 */
const SecuritySettings: React.FC = () => {
  const { t } = useTranslation();

  usePageTitle(t('settings.securitySettings.pageTitle'));

  return (
    <>
      <SettingsPageHeader icon="security" title={t('settings.securitySettings.pageTitle')} description={t('settings.securitySettings.pageDescription')} />

      <PageContent>
        <PasswordChangeSection />
        <ClipboardClearSection />
        <QuickVaultUnlockSection />
        <DeleteAccountSection />
      </PageContent>
    </>
  );
};

export default SecuritySettings;
