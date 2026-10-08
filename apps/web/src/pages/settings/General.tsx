import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import Card from '@/components/shared/Card';
import FormLabel from '@/components/shared/FormLabel';
import PageContent from '@/components/shared/PageContent';
import SectionTitle from '@/components/shared/SectionTitle';
import Select from '@/components/shared/Select';
import { useDb } from '@/context/DbContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVaultMutate } from '@/hooks/useVaultMutate';
import { AVAILABLE_LANGUAGES } from '@/i18n/config';
import { changeLanguage } from '@/i18n/i18n';

/**
 * The general settings page.
 */
const GeneralSettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const dbContext = useDb();
  const { executeVaultMutationInBackground } = useVaultMutate();

  usePageTitle(t('settings.general.pageTitle'));

  const [autoEmailRefresh, setAutoEmailRefresh] = useState(true);
  const [appLanguage, setAppLanguage] = useState(i18n.language);

  /**
   * Write a vault setting and push it.
   */
  const updateSetting = useCallback(async (key: string, value: string): Promise<void> => {
    await executeVaultMutationInBackground(async () => {
      dbContext.sqliteClient?.settings.updateSetting(key, value);
    });
  }, [dbContext.sqliteClient, executeVaultMutationInBackground]);

  useEffect(() => {
    const client = dbContext.sqliteClient;
    if (client) {
      setAutoEmailRefresh(client.settings.getSetting('AutoEmailRefresh', 'True').toLowerCase() === 'true');
    }
  }, [dbContext.sqliteClient]);

  /**
   * Switch the UI language, remembered in the vault and locally.
   */
  const updateAppLanguage = async (code: string): Promise<void> => {
    setAppLanguage(code);
    await changeLanguage(code);
    await updateSetting('AppLanguage', code);
  };

  return (
    <>
      <SettingsPageHeader icon="general" title={t('settings.general.pageTitle')} description={t('settings.general.pageDescription')} />

      <PageContent>
        <Card>
          <SectionTitle className="mb-4">{t('settings.general.appLanguageTitle')}</SectionTitle>
          <div>
            <FormLabel htmlFor="appLanguage">{t('settings.language')}</FormLabel>
            <Select id="appLanguage" value={appLanguage} onChange={e => void updateAppLanguage(e.target.value)}>
              {AVAILABLE_LANGUAGES.map(language => <option key={language.code} value={language.code}>{language.flag} {language.nativeName}</option>)}
            </Select>
            <span className="block mt-2 text-sm text-gray-500 dark:text-gray-400">{t('settings.general.appLanguageDescription')}</span>
          </div>
        </Card>

        <Card>
          <SectionTitle className="mb-4">{t('settings.general.emailSettingsTitle')}</SectionTitle>
          <div className="flex items-center">
            <input id="autoEmailRefresh" type="checkbox" checked={autoEmailRefresh} onChange={(e) => {
              setAutoEmailRefresh(e.target.checked);
              void updateSetting('AutoEmailRefresh', e.target.checked ? 'True' : 'False');
            }} className="w-4 h-4 text-primary-600 bg-gray-100 border-gray-300 rounded focus:ring-primary-500 dark:focus:ring-primary-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600" />
            <label htmlFor="autoEmailRefresh" className="ml-2 text-sm font-medium text-gray-900 dark:text-gray-300">{t('settings.general.autoEmailRefreshLabel')}</label>
          </div>
        </Card>
      </PageContent>
    </>
  );
};

export default GeneralSettings;
