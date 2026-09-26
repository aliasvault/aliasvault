import { getIdentityAgeRanges, getIdentityLanguages } from '@aliasvault/client/rust/RustCore';
import { getLanguageInfo, resolveDefaultLanguage } from '@aliasvault/models/defaults';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import DefaultPasswordSettings from '@/components/settings/DefaultPasswordSettings';
import Card from '@/components/shared/Card';
import FormLabel from '@/components/shared/FormLabel';
import PageContent from '@/components/shared/PageContent';
import PageHeader from '@/components/shared/PageHeader';
import Select from '@/components/shared/Select';
import { getAppConfig } from '@/config/AppConfig';
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
  const { executeVaultMutationAsync } = useVaultMutate();
  const tk = 'pages.main.settings.general';
  usePageTitle(t(`${tk}.PageTitle`));

  const [privateDomains, setPrivateDomains] = useState<string[]>([]);
  const [publicDomains, setPublicDomains] = useState<string[]>([]);
  const [defaultEmailDomain, setDefaultEmailDomain] = useState('');
  const [autoEmailRefresh, setAutoEmailRefresh] = useState(true);
  const [identityLanguages, setIdentityLanguages] = useState<string[]>([]);
  const [ageRanges, setAgeRanges] = useState<string[]>([]);
  const [identityLanguage, setIdentityLanguage] = useState('');
  const [identityGender, setIdentityGender] = useState('random');
  const [identityAgeRange, setIdentityAgeRange] = useState('random');
  const [appLanguage, setAppLanguage] = useState(i18n.language);
  const [clipboardClearSeconds, setClipboardClearSeconds] = useState('10');

  /**
   * Write a vault setting and push it.
   */
  const updateSetting = useCallback(async (key: string, value: string): Promise<void> => {
    await executeVaultMutationAsync(async () => {
      dbContext.sqliteClient?.settings.updateSetting(key, value);
    });
  }, [dbContext.sqliteClient, executeVaultMutationAsync]);

  /**
   * The identity language: the explicit setting, or the one matching the UI language.
   */
  const resolveIdentityLanguage = useCallback((languages: string[]): string => {
    const explicit = dbContext.sqliteClient?.settings.getDefaultIdentityLanguage() ?? '';
    return explicit.trim().length > 0 ? explicit : resolveDefaultLanguage(i18n.language, languages);
  }, [dbContext.sqliteClient, i18n.language]);

  useEffect(() => {
    const client = dbContext.sqliteClient;
    if (!client) {
      return;
    }
    let cancelled = false;

    /**
     * Load the domains and the current settings.
     */
    const load = async (): Promise<void> => {
      const metadata = await vaultStore.getVaultMetadata();
      const hidden = metadata?.hiddenPrivateEmailDomains ?? getAppConfig().hiddenPrivateEmailDomains;
      const privateList = (metadata?.privateEmailDomains ?? getAppConfig().privateEmailDomains).filter(d => !hidden.includes(d));
      const publicList = metadata?.publicEmailDomains ?? [];
      const languages = (await getIdentityLanguages()).sort((a, b) => getLanguageInfo(a).label.localeCompare(getLanguageInfo(b).label));
      const ranges = await getIdentityAgeRanges();
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
      setIdentityLanguages(languages);
      setAgeRanges(ranges);
      setIdentityLanguage(resolveIdentityLanguage(languages));
      setIdentityGender(client.settings.getDefaultIdentityGender());
      setIdentityAgeRange(client.settings.getDefaultIdentityAgeRange());
      setClipboardClearSeconds(client.settings.getSetting('ClipboardClearSeconds', '10'));
    };
    void load();
    return (): void => {
      cancelled = true;
    };
  }, [dbContext.sqliteClient, resolveIdentityLanguage]);

  /**
   * Switch the UI language, remembered in the vault and locally, and refresh the derived identity language.
   */
  const updateAppLanguage = async (code: string): Promise<void> => {
    setAppLanguage(code);
    await changeLanguage(code);
    await updateSetting('AppLanguage', code);
    setIdentityLanguage(resolveIdentityLanguage(identityLanguages));
  };

  return (
    <>
      <PageHeader breadcrumbItems={[{ displayName: t(`${tk}.BreadcrumbTitle`) }]} title={t(`${tk}.PageTitle`)} description={t(`${tk}.PageDescription`)} />

      <PageContent>
        <Card>
          <h3 className="mb-4 text-lg font-medium text-gray-900 dark:text-white">{t(`${tk}.AppLanguageTitle`)}</h3>
          <div className="mb-4">
            <FormLabel htmlFor="appLanguage">{t(`${tk}.AppLanguageLabel`)}</FormLabel>
            <Select id="appLanguage" value={appLanguage} onChange={e => void updateAppLanguage(e.target.value)}>
              {AVAILABLE_LANGUAGES.map(language => <option key={language.code} value={language.code}>{language.flag} {language.nativeName}</option>)}
            </Select>
            <span className="block text-sm font-normal text-gray-500 truncate dark:text-gray-400">{t(`${tk}.AppLanguageDescription`)}</span>
          </div>
        </Card>

        <Card>
          <h3 className="mb-4 text-lg font-medium text-gray-900 dark:text-white">{t(`${tk}.EmailSettingsTitle`)}</h3>
          <div className="mb-4">
            <FormLabel htmlFor="defaultEmailDomain">{t(`${tk}.DefaultEmailDomainLabel`)}</FormLabel>
            <Select id="defaultEmailDomain" value={defaultEmailDomain} onChange={(e) => {
              setDefaultEmailDomain(e.target.value);
              void updateSetting('DefaultEmailDomain', e.target.value);
            }}>
              <optgroup label={t(`${tk}.PrivateDomainsLabel`)}>
                {hasValidPrivateDomains(privateDomains)
                  ? privateDomains.map(domain => <option key={domain} value={domain}>{domain}</option>)
                  : <option disabled value="_">{t(`${tk}.PrivateDomainsDisabledLabel`)}</option>}
              </optgroup>
              <optgroup label={t(`${tk}.PublicDomainsLabel`)}>
                {publicDomains.map(domain => <option key={domain} value={domain}>{domain}</option>)}
              </optgroup>
            </Select>
            <span className="block text-sm font-normal text-gray-500 dark:text-gray-400 mt-2">
              {t(`${tk}.DefaultEmailDomainDescription`)} {t(`${tk}.DefaultEmailDomainDescriptionNote`)} <a href="https://docs.aliasvault.com/misc/private-vs-public-email.html" className="text-primary-500 hover:text-primary-700 hover:underline" target="_blank" rel="noopener noreferrer">{t(`${tk}.DefaultEmailDomainLearnMore`)}</a>.
            </span>
          </div>

          <div className="flex items-center mb-4">
            <input id="autoEmailRefresh" type="checkbox" checked={autoEmailRefresh} onChange={(e) => {
              setAutoEmailRefresh(e.target.checked);
              void updateSetting('AutoEmailRefresh', e.target.checked ? 'True' : 'False');
            }} className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600" />
            <label htmlFor="autoEmailRefresh" className="ml-2 text-sm font-medium text-gray-900 dark:text-gray-300">{t(`${tk}.AutoEmailRefreshLabel`)}</label>
          </div>
        </Card>

        <Card>
          <h3 className="mb-4 text-lg font-medium text-gray-900 dark:text-white">{t(`${tk}.AliasSettingsTitle`)}</h3>

          <div className="mb-4">
            <FormLabel htmlFor="defaultIdentityLanguage">{t(`${tk}.AliasGenerationLanguageLabel`)}</FormLabel>
            <Select id="defaultIdentityLanguage" value={identityLanguage} onChange={(e) => {
              setIdentityLanguage(e.target.value);
              void updateSetting('DefaultIdentityLanguage', e.target.value);
            }}>
              {identityLanguages.map(code => <option key={code} value={code}>{getLanguageInfo(code).flag} {getLanguageInfo(code).label}</option>)}
            </Select>
            <span className="block text-sm font-normal text-gray-500 truncate dark:text-gray-400">{t(`${tk}.AliasGenerationLanguageDescription`)}</span>
          </div>

          <div className="mb-4">
            <FormLabel htmlFor="defaultIdentityGender">{t(`${tk}.AliasGenerationGenderLabel`)}</FormLabel>
            <Select id="defaultIdentityGender" value={identityGender} onChange={(e) => {
              setIdentityGender(e.target.value);
              void updateSetting('DefaultIdentityGender', e.target.value);
            }}>
              <option value="random">{t(`${tk}.RandomOption`)}</option>
              <option value="male">{t(`${tk}.MaleOption`)}</option>
              <option value="female">{t(`${tk}.FemaleOption`)}</option>
            </Select>
            <span className="block text-sm font-normal text-gray-500 truncate dark:text-gray-400">{t(`${tk}.AliasGenerationGenderDescription`)}</span>
          </div>

          <div className="mb-4">
            <FormLabel htmlFor="defaultIdentityAgeRange">{t(`${tk}.AliasGenerationAgeRangeLabel`)}</FormLabel>
            <Select id="defaultIdentityAgeRange" value={identityAgeRange} onChange={(e) => {
              setIdentityAgeRange(e.target.value);
              void updateSetting('DefaultIdentityAgeRange', e.target.value);
            }}>
              {ageRanges.map(range => <option key={range} value={range}>{range === 'random' ? t(`${tk}.RandomOption`) : range}</option>)}
            </Select>
            <span className="block text-sm font-normal text-gray-500 truncate dark:text-gray-400">{t(`${tk}.AliasGenerationAgeRangeDescription`)}</span>
          </div>
        </Card>

        <Card>
          <h3 className="mb-4 text-lg font-medium text-gray-900 dark:text-white">{t(`${tk}.ClipboardSettingsTitle`)}</h3>
          <div className="mb-4">
            <FormLabel htmlFor="clipboardClearSeconds">{t(`${tk}.ClipboardClearSecondsLabel`)}</FormLabel>
            <Select id="clipboardClearSeconds" value={clipboardClearSeconds} onChange={(e) => {
              setClipboardClearSeconds(e.target.value);
              void updateSetting('ClipboardClearSeconds', e.target.value);
            }}>
              <option value="0">{t(`${tk}.ClipboardClearDisabledOption`)}</option>
              <option value="5">{t(`${tk}.ClipboardClear5SecondsOption`)}</option>
              <option value="10">{t(`${tk}.ClipboardClear10SecondsOption`)}</option>
              <option value="15">{t(`${tk}.ClipboardClear15SecondsOption`)}</option>
            </Select>
            <span className="block text-sm font-normal text-gray-500 dark:text-gray-400">{t(`${tk}.ClipboardClearSecondsDescription`)}</span>
            <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg dark:bg-yellow-900/20 dark:border-yellow-800">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">{t(`${tk}.ClipboardClearLimitationNote`)}</p>
            </div>
          </div>
        </Card>

        <Card>
          <h3 className="mb-4 text-lg font-medium text-gray-900 dark:text-white">{t(`${tk}.PasswordSettingsTitle`)}</h3>
          <DefaultPasswordSettings />
        </Card>
      </PageContent>
    </>
  );
};

export default GeneralSettings;
