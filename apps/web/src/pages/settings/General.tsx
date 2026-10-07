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
import { vaultStore } from '@/vault/VaultStore';

/**
 * Whether the private domain list holds a usable domain.
 */
const hasValidPrivateDomains = (domains: string[]): boolean => domains.length > 0 && !(domains.length === 1 && (domains[0].trim().length === 0 || domains[0] === 'DISABLED.TLD'));

/**
 * The general settings page.
 */
const GeneralSettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const dbContext = useDb();
  const { executeVaultMutationInBackground } = useVaultMutate();
  
  usePageTitle(t('settings.general.pageTitle'));

  const [privateDomains, setPrivateDomains] = useState<string[]>([]);
  const [publicDomains, setPublicDomains] = useState<string[]>([]);
  const [defaultEmailDomain, setDefaultEmailDomain] = useState('');
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
    if (!client) {
      return;
    }
    let cancelled = false;

    /**
     * Load the email domains and the current settings.
     */
    const load = async (): Promise<void> => {
      const metadata = await vaultStore.getVaultMetadata();
      const hidden = metadata?.hiddenPrivateEmailDomains ?? [];
      const privateList = (metadata?.privateEmailDomains ?? []).filter(d => !hidden.includes(d));
      const publicList = metadata?.publicEmailDomains ?? [];
      if (cancelled) {
        return;
      }

      setPrivateDomains(privateList);
      setPublicDomains(publicList);
      let domain = client.settings.getDefaultEmailDomain();
      if (domain.length === 0 || hidden.includes(domain)) {
        domain = hasValidPrivateDomains(privateList) ? privateList[0] : publicList[0] ?? '';
      }
      setDefaultEmailDomain(domain);
      setAutoEmailRefresh(client.settings.getSetting('AutoEmailRefresh', 'True').toLowerCase() === 'true');
    };
    void load();
    return (): void => {
      cancelled = true;
    };
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
          <div className="mb-4">
            <FormLabel htmlFor="appLanguage">{t('settings.language')}</FormLabel>
            <Select id="appLanguage" value={appLanguage} onChange={e => void updateAppLanguage(e.target.value)}>
              {AVAILABLE_LANGUAGES.map(language => <option key={language.code} value={language.code}>{language.flag} {language.nativeName}</option>)}
            </Select>
            <span className="block text-sm font-normal text-gray-500 truncate dark:text-gray-400">{t('settings.general.appLanguageDescription')}</span>
          </div>
        </Card>

        <Card>
          <SectionTitle className="mb-4">{t('settings.general.emailSettingsTitle')}</SectionTitle>
          <div className="mb-4">
            <FormLabel htmlFor="defaultEmailDomain">{t('settings.general.defaultEmailDomainLabel')}</FormLabel>
            <Select id="defaultEmailDomain" value={defaultEmailDomain} onChange={(e) => {
              setDefaultEmailDomain(e.target.value);
              void updateSetting('DefaultEmailDomain', e.target.value);
            }}>
              <optgroup label={t('settings.general.privateDomainsLabel')}>
                {hasValidPrivateDomains(privateDomains)
                  ? privateDomains.map(domain => <option key={domain} value={domain}>{domain}</option>)
                  : <option disabled value="_">{t('settings.general.privateDomainsDisabledLabel')}</option>}
              </optgroup>
              <optgroup label={t('settings.general.publicDomainsLabel')}>
                {publicDomains.map(domain => <option key={domain} value={domain}>{domain}</option>)}
              </optgroup>
            </Select>
            <span className="block text-sm font-normal text-gray-500 dark:text-gray-400 mt-2">
              {t('settings.general.defaultEmailDomainDescription')} {t('settings.general.defaultEmailDomainDescriptionNote')} <a href="https://docs.aliasvault.com/misc/private-vs-public-email.html" className="text-primary-500 hover:text-primary-700 hover:underline" target="_blank" rel="noopener noreferrer">{t('settings.general.defaultEmailDomainLearnMore')}</a>.
            </span>
          </div>

          <div className="flex items-center mb-4">
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
