import React from 'react';
import { useTranslation } from 'react-i18next';

import ClipboardClearSection from '@/components/settings/security/ClipboardClearSection';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import PageContent from '@/components/shared/PageContent';
import { usePageTitle } from '@/hooks/usePageTitle';

/**
 * The clipboard page: how long copied secrets stay on the clipboard.
 */
const Clipboard: React.FC = () => {
  const { t } = useTranslation();

  usePageTitle(t('settings.clipboardClear'));

  return (
    <>
      <SettingsPageHeader icon="clipboard" title={t('settings.clipboardClear')} description={t('settings.clipboardClearDescription')} />

      <PageContent>
        <ClipboardClearSection />
      </PageContent>
    </>
  );
};

export default Clipboard;
