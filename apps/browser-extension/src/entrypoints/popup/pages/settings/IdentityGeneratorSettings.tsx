import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useVaultMutate } from '@/entrypoints/popup/hooks/useVaultMutate';

import { getAvailableLanguages, getAvailableAgeRanges, ILanguageOption, IAgeRangeOption } from '@/utils/dist/core/identity-generator';

/**
 * Identity Generator Settings page component.
 * Allows users to configure default language, gender, and age range for identity generation.
 */
const IdentityGeneratorSettings: React.FC = () => {
  const { t } = useTranslation();
  const { setIsInitialLoading } = useLoading();
  const dbContext = useDb();
  const { executeVaultMutationAsync } = useVaultMutate();

  const [language, setLanguage] = useState<string>('en');
  const [gender, setGender] = useState<string>('random');
  const [ageRange, setAgeRange] = useState<string>('random');
  const [languageOptions, setLanguageOptions] = useState<ILanguageOption[]>([]);
  const [ageRangeOptions, setAgeRangeOptions] = useState<IAgeRangeOption[]>([]);

  const GENDER_OPTIONS = [
    { label: t('settings.identityGeneratorSettings.genderOptions.random'), value: 'random' },
    { label: t('settings.identityGeneratorSettings.genderOptions.male'), value: 'male' },
    { label: t('settings.identityGeneratorSettings.genderOptions.female'), value: 'female' }
  ];

  /**
   * Load settings on mount.
   */
  useEffect(() => {
    const languages = getAvailableLanguages();
    const ranges = getAvailableAgeRanges();
    setLanguageOptions(languages);
    setAgeRangeOptions(ranges);

    if (dbContext?.sqliteClient) {
      const currentLanguage = dbContext.sqliteClient.settings.getEffectiveIdentityLanguage();
      const currentGender = dbContext.sqliteClient.settings.getDefaultIdentityGender();
      const currentAgeRange = dbContext.sqliteClient.settings.getDefaultIdentityAgeRange();

      setLanguage(currentLanguage);
      setGender(currentGender);
      setAgeRange(currentAgeRange);
    }

    setIsInitialLoading(false);
  }, [dbContext?.sqliteClient, setIsInitialLoading]);

  /**
   * Handle language change.
   */
  const handleLanguageChange = useCallback(async (newLanguage: string): Promise<void> => {
    setLanguage(newLanguage);
    if (dbContext?.sqliteClient) {
      await executeVaultMutationAsync(async () => {
        dbContext.sqliteClient!.settings.updateSetting('DefaultIdentityLanguage', newLanguage);
      });
    }
  }, [dbContext?.sqliteClient, executeVaultMutationAsync]);

  /**
   * Handle gender change.
   */
  const handleGenderChange = useCallback(async (newGender: string): Promise<void> => {
    setGender(newGender);
    if (dbContext?.sqliteClient) {
      await executeVaultMutationAsync(async () => {
        dbContext.sqliteClient!.settings.updateSetting('DefaultIdentityGender', newGender);
      });
    }
  }, [dbContext?.sqliteClient, executeVaultMutationAsync]);

  /**
   * Handle age range change.
   */
  const handleAgeRangeChange = useCallback(async (newAgeRange: string): Promise<void> => {
    setAgeRange(newAgeRange);
    if (dbContext?.sqliteClient) {
      await executeVaultMutationAsync(async () => {
        dbContext.sqliteClient!.settings.updateSetting('DefaultIdentityAgeRange', newAgeRange);
      });
    }
  }, [dbContext?.sqliteClient, executeVaultMutationAsync]);

  return (
    <div className="space-y-6">
      {/* Language Section */}
      <section>
        <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-3">
          {t('settings.identityGeneratorSettings.languageSection')}
        </h3>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="p-4">
            <p className="font-medium text-gray-900 dark:text-white mb-2">
              {t('settings.identityGeneratorSettings.languageSection')}
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              {t('settings.identityGeneratorSettings.languageDescription')}
            </p>
            <select
              value={language}
              onChange={(e) => handleLanguageChange(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white focus:ring-primary-500 focus:border-primary-500"
            >
              {languageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.flag} {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Gender Section */}
      <section>
        <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-3">
          {t('settings.identityGeneratorSettings.genderSection')}
        </h3>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="p-4">
            <p className="font-medium text-gray-900 dark:text-white mb-2">
              {t('settings.identityGeneratorSettings.genderSection')}
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              {t('settings.identityGeneratorSettings.genderDescription')}
            </p>
            <select
              value={gender}
              onChange={(e) => handleGenderChange(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white focus:ring-primary-500 focus:border-primary-500"
            >
              {GENDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Age Range Section */}
      <section>
        <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-3">
          {t('settings.identityGeneratorSettings.ageRangeSection')}
        </h3>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="p-4">
            <p className="font-medium text-gray-900 dark:text-white mb-2">
              {t('settings.identityGeneratorSettings.ageRangeSection')}
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              {t('settings.identityGeneratorSettings.ageRangeDescription')}
            </p>
            <select
              value={ageRange}
              onChange={(e) => handleAgeRangeChange(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white focus:ring-primary-500 focus:border-primary-500"
            >
              {ageRangeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value === 'random' ? t('settings.identityGeneratorSettings.genderOptions.random') : option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>
    </div>
  );
};

export default IdentityGeneratorSettings;
