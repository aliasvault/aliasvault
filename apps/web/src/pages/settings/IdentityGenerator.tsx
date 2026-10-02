import { getIdentityAgeRanges, getIdentityLanguages } from '@aliasvault/client/rust/RustCore';
import { getLanguageInfo, resolveDefaultLanguage } from '@aliasvault/i18n/languages';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import Card from '@/components/shared/Card';
import FormLabel from '@/components/shared/FormLabel';
import PageContent from '@/components/shared/PageContent';
import Select from '@/components/shared/Select';
import { useDb } from '@/context/DbContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVaultMutate } from '@/hooks/useVaultMutate';

/**
 * The identity generator settings page: defaults for newly generated identities.
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
     * Load the identity options and the current settings.
     */
    const load = async (): Promise<void> => {
      const languages = (await getIdentityLanguages()).sort((a, b) => getLanguageInfo(a).label.localeCompare(getLanguageInfo(b).label));
      const ranges = await getIdentityAgeRanges();
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
        <Card>
          <div className="mb-4">
            <FormLabel htmlFor="defaultIdentityLanguage">{t('settings.language')}</FormLabel>
            <Select id="defaultIdentityLanguage" value={identityLanguage} onChange={(e) => {
              setIdentityLanguage(e.target.value);
              void updateSetting('DefaultIdentityLanguage', e.target.value);
            }}>
              {identityLanguages.map(code => <option key={code} value={code}>{getLanguageInfo(code).flag} {getLanguageInfo(code).label}</option>)}
            </Select>
            <span className="block text-sm font-normal text-gray-500 truncate dark:text-gray-400">{t('settings.general.aliasGenerationLanguageDescription')}</span>
          </div>

          <div className="mb-4">
            <FormLabel htmlFor="defaultIdentityGender">{t('fieldLabels.alias.gender')}</FormLabel>
            <Select id="defaultIdentityGender" value={identityGender} onChange={(e) => {
              setIdentityGender(e.target.value);
              void updateSetting('DefaultIdentityGender', e.target.value);
            }}>
              <option value="random">{t('settings.identityGeneratorSettings.genderOptions.random')}</option>
              <option value="male">{t('settings.identityGeneratorSettings.genderOptions.male')}</option>
              <option value="female">{t('settings.identityGeneratorSettings.genderOptions.female')}</option>
            </Select>
            <span className="block text-sm font-normal text-gray-500 truncate dark:text-gray-400">{t('settings.general.aliasGenerationGenderDescription')}</span>
          </div>

          <div className="mb-4">
            <FormLabel htmlFor="defaultIdentityAgeRange">{t('settings.identityGeneratorSettings.ageRangeSection')}</FormLabel>
            <Select id="defaultIdentityAgeRange" value={identityAgeRange} onChange={(e) => {
              setIdentityAgeRange(e.target.value);
              void updateSetting('DefaultIdentityAgeRange', e.target.value);
            }}>
              {ageRanges.map(range => <option key={range} value={range}>{range === 'random' ? t('settings.identityGeneratorSettings.genderOptions.random') : range}</option>)}
            </Select>
            <span className="block text-sm font-normal text-gray-500 truncate dark:text-gray-400">{t('settings.general.aliasGenerationAgeRangeDescription')}</span>
          </div>
        </Card>
      </PageContent>
    </>
  );
};

export default IdentityGeneratorSettings;
