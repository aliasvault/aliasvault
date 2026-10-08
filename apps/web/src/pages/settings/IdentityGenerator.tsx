import { getIdentityAgeRanges, getIdentityLanguages } from '@aliasvault/client/rust/RustCore';
import { getLanguageInfo, resolveDefaultLanguage } from '@aliasvault/i18n/languages';
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
import { vaultStore } from '@/vault/VaultStore';

/**
 * Whether the private domain list holds a usable domain.
 */
const hasValidPrivateDomains = (domains: string[]): boolean => domains.length > 0 && !(domains.length === 1 && (domains[0].trim().length === 0 || domains[0] === 'DISABLED.TLD'));

/**
 * The identity generator settings page: defaults for newly generated identities, including their email domain.
 */
const IdentityGeneratorSettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const dbContext = useDb();
  const { executeVaultMutationInBackground } = useVaultMutate();

  usePageTitle(t('settings.identityGenerator'));

  const [identityLanguages, setIdentityLanguages] = useState<string[]>([]);
  const [ageRanges, setAgeRanges] = useState<string[]>([]);
  const [identityLanguage, setIdentityLanguage] = useState('');
  const [identityGender, setIdentityGender] = useState('random');
  const [identityAgeRange, setIdentityAgeRange] = useState('random');
  const [privateDomains, setPrivateDomains] = useState<string[]>([]);
  const [publicDomains, setPublicDomains] = useState<string[]>([]);
  const [defaultEmailDomain, setDefaultEmailDomain] = useState('');

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
     * Load the identity options, the email domains and the current settings.
     */
    const load = async (): Promise<void> => {
      const languages = (await getIdentityLanguages()).sort((a, b) => getLanguageInfo(a).label.localeCompare(getLanguageInfo(b).label));
      const ranges = await getIdentityAgeRanges();
      const metadata = await vaultStore.getVaultMetadata();
      const hidden = metadata?.hiddenPrivateEmailDomains ?? [];
      const privateList = (metadata?.privateEmailDomains ?? []).filter(d => !hidden.includes(d));
      const publicList = metadata?.publicEmailDomains ?? [];
      if (cancelled) {
        return;
      }

      // The identity language: the explicit setting, or the one matching the UI language.
      const explicit = client.settings.getDefaultIdentityLanguage();
      setIdentityLanguages(languages);
      setAgeRanges(ranges);
      setIdentityLanguage(explicit.trim().length > 0 ? explicit : resolveDefaultLanguage(i18n.language, languages));
      setIdentityGender(client.settings.getDefaultIdentityGender());
      setIdentityAgeRange(client.settings.getDefaultIdentityAgeRange());

      setPrivateDomains(privateList);
      setPublicDomains(publicList);
      let domain = client.settings.getDefaultEmailDomain();
      if (domain.length === 0 || hidden.includes(domain)) {
        domain = hasValidPrivateDomains(privateList) ? privateList[0] : publicList[0] ?? '';
      }
      setDefaultEmailDomain(domain);
    };
    void load();
    return (): void => {
      cancelled = true;
    };
  }, [dbContext.sqliteClient, i18n.language]);

  return (
    <>
      <SettingsPageHeader icon="identityGenerator" title={t('settings.identityGenerator')} description={t('settings.identityGeneratorSettings.description')} />

      <PageContent>
        <Card className="space-y-5">
          <div>
            <FormLabel htmlFor="defaultIdentityLanguage">{t('settings.language')}</FormLabel>
            <Select id="defaultIdentityLanguage" value={identityLanguage} onChange={(e) => {
              setIdentityLanguage(e.target.value);
              void updateSetting('DefaultIdentityLanguage', e.target.value);
            }}>
              {identityLanguages.map(code => <option key={code} value={code}>{getLanguageInfo(code).flag} {getLanguageInfo(code).label}</option>)}
            </Select>
            <span className="block mt-2 text-sm text-gray-500 dark:text-gray-400">{t('settings.general.aliasGenerationLanguageDescription')}</span>
          </div>

          <div>
            <FormLabel htmlFor="defaultIdentityGender">{t('fieldLabels.alias.gender')}</FormLabel>
            <Select id="defaultIdentityGender" value={identityGender} onChange={(e) => {
              setIdentityGender(e.target.value);
              void updateSetting('DefaultIdentityGender', e.target.value);
            }}>
              <option value="random">{t('settings.identityGeneratorSettings.genderOptions.random')}</option>
              <option value="male">{t('settings.identityGeneratorSettings.genderOptions.male')}</option>
              <option value="female">{t('settings.identityGeneratorSettings.genderOptions.female')}</option>
            </Select>
            <span className="block mt-2 text-sm text-gray-500 dark:text-gray-400">{t('settings.general.aliasGenerationGenderDescription')}</span>
          </div>

          <div>
            <FormLabel htmlFor="defaultIdentityAgeRange">{t('settings.identityGeneratorSettings.ageRangeSection')}</FormLabel>
            <Select id="defaultIdentityAgeRange" value={identityAgeRange} onChange={(e) => {
              setIdentityAgeRange(e.target.value);
              void updateSetting('DefaultIdentityAgeRange', e.target.value);
            }}>
              {ageRanges.map(range => <option key={range} value={range}>{range === 'random' ? t('settings.identityGeneratorSettings.genderOptions.random') : range}</option>)}
            </Select>
            <span className="block mt-2 text-sm text-gray-500 dark:text-gray-400">{t('settings.general.aliasGenerationAgeRangeDescription')}</span>
          </div>
        </Card>

        <Card>
          <SectionTitle className="mb-4">{t('settings.general.emailSettingsTitle')}</SectionTitle>
          <div>
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
        </Card>
      </PageContent>
    </>
  );
};

export default IdentityGeneratorSettings;
