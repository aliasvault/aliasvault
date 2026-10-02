import React from 'react';
import { useTranslation } from 'react-i18next';

import DefaultPasswordSettings from '@/components/settings/DefaultPasswordSettings';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import Card from '@/components/shared/Card';
import PageContent from '@/components/shared/PageContent';
import { usePageTitle } from '@/hooks/usePageTitle';

/**
 * The password generator settings page: defaults for newly generated passwords.
 */
const PasswordGeneratorSettings: React.FC = () => {
  const { t } = useTranslation();

  usePageTitle(t('settings.passwordGenerator'));

  return (
    <>
      <SettingsPageHeader icon="passwordGenerator" title={t('settings.passwordGenerator')} />

      <PageContent>
        <Card>
          <DefaultPasswordSettings />
        </Card>
      </PageContent>
    </>
  );
};

export default PasswordGeneratorSettings;
