import React from 'react';
import { useTranslation } from 'react-i18next';

import QuickVaultUnlockSection from '@/components/settings/security/QuickVaultUnlockSection';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import Card from '@/components/shared/Card';
import Icon from '@/components/shared/Icon';
import PageContent from '@/components/shared/PageContent';
import StatusPill from '@/components/shared/StatusPill';
import Text from '@/components/shared/Text';
import { usePageTitle } from '@/hooks/usePageTitle';

/**
 * The vault unlock method page.
 */
const VaultUnlock: React.FC = () => {
  const { t } = useTranslation();

  usePageTitle(t('settings.vaultUnlock'));

  return (
    <>
      <SettingsPageHeader icon="vaultUnlock" title={t('settings.vaultUnlock')} description={t('settings.vaultUnlockSettings.description')} />

      <PageContent>
        <QuickVaultUnlockSection />

        <Card className="bg-gray-50 dark:bg-gray-800/60">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3 min-w-0">
              <Icon name="lock-closed" className="flex-shrink-0 w-5 h-5 text-gray-500 dark:text-gray-400" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{t('auth.masterPassword')}</h3>
            </div>
            <StatusPill id="master-password-unlock-status" enabled size="md" />
          </div>
          <Text variant="muted">{t('settings.vaultUnlockSettings.passwordHelp')}</Text>
        </Card>
      </PageContent>
    </>
  );
};

export default VaultUnlock;
