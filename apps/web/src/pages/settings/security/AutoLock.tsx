import React from 'react';
import { useTranslation } from 'react-i18next';

import AutoLockSection from '@/components/settings/security/AutoLockSection';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import PageContent from '@/components/shared/PageContent';
import { usePageTitle } from '@/hooks/usePageTitle';

/**
 * The auto-lock page: how long the vault may stay idle before it locks.
 */
const AutoLock: React.FC = () => {
  const { t } = useTranslation();

  usePageTitle(t('settings.autoLock'));

  return (
    <>
      <SettingsPageHeader icon="autoLock" title={t('settings.autoLock')} description={t('settings.autoLockTimeoutDescription')} />

      <PageContent>
        <AutoLockSection />
      </PageContent>
    </>
  );
};

export default AutoLock;
