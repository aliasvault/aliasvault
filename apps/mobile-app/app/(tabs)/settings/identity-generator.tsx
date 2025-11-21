import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, Alert, TouchableOpacity } from 'react-native';

import { getAvailableAgeRanges, IAgeRangeOption, getAvailableLanguages, ILanguageOption } from '@/utils/dist/shared/identity-generator';

import { useColors } from '@/hooks/useColorScheme';
import { useVaultMutate } from '@/hooks/useVaultMutate';

import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { useDb } from '@/context/DbContext';

/**
 * Identity Generator Settings screen.
 */
export default function IdentityGeneratorSettingsScreen(): React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const dbContext = useDb();
  const { executeVaultMutation } = useVaultMutate();

  const [language, setLanguage] = useState<string>('en');
  const [gender, setGender] = useState<string>('random');
  const [ageRange, setAgeRange] = useState<string>('random');
  const [languageOptions, setLanguageOptions] = useState<ILanguageOption[]>([]);
  const [ageRangeOptions, setAgeRangeOptions] = useState<IAgeRangeOption[]>([]);

  // Store pending changes and initial values
  const pendingChanges = useRef<{ language?: string; gender?: string; ageRange?: string }>({});
  const initialValues = useRef<{ language: string; gender: string; ageRange: string }>({ language: 'en', gender: 'random', ageRange: 'random' });

  const GENDER_OPTIONS = [
    { label: t('settings.identityGeneratorSettings.genderOptions.random'), value: 'random' },
    { label: t('settings.identityGeneratorSettings.genderOptions.male'), value: 'male' },
    { label: t('settings.identityGeneratorSettings.genderOptions.female'), value: 'female' }
  ];

  // Load available languages and age ranges on mount
  useEffect(() => {
    const languages = getAvailableLanguages();
    const ranges = getAvailableAgeRanges();
    setLanguageOptions(languages);
    setAgeRangeOptions(ranges);
  }, []);

  useFocusEffect(
    useCallback(() => {
      /**
       * Load the identity generator settings on focus.
       */
      const loadSettings = async (): Promise<void> => {
        try {
          const [currentLanguage, currentGender, currentAgeRange] = await Promise.all([
            dbContext.sqliteClient!.getDefaultIdentityLanguage(),
            dbContext.sqliteClient!.getDefaultIdentityGender(),
            dbContext.sqliteClient!.getDefaultIdentityAgeRange()
          ]);

          setLanguage(currentLanguage);
          setGender(currentGender);
          setAgeRange(currentAgeRange);
          // Store initial values
          initialValues.current = { language: currentLanguage, gender: currentGender, ageRange: currentAgeRange };
          // Clear pending changes when screen loads
          pendingChanges.current = {};
        } catch (error) {
          console.error('Error loading identity generator settings:', error);
          Alert.alert(t('common.error'), t('common.errors.unknownError'));
        }
      };

      loadSettings();

      // Save changes when screen loses focus (navigating away)
      return (): void => {
        /**
         * Save pending changes to the database.
         */
        const saveChanges = async (): Promise<void> => {
          // Check if there are pending changes to save
          const hasChanges = Object.keys(pendingChanges.current).length > 0;

          if (!hasChanges) {
            return;
          }

          try {
            // Save all pending changes in a single vault mutation
            await executeVaultMutation(async () => {
              if (pendingChanges.current.language !== undefined) {
                await dbContext.sqliteClient!.updateSetting('DefaultIdentityLanguage', pendingChanges.current.language);
              }
              if (pendingChanges.current.gender !== undefined) {
                await dbContext.sqliteClient!.updateSetting('DefaultIdentityGender', pendingChanges.current.gender);
              }
              if (pendingChanges.current.ageRange !== undefined) {
                await dbContext.sqliteClient!.updateSetting('DefaultIdentityAgeRange', pendingChanges.current.ageRange);
              }
            });

            // Clear pending changes after successful save
            pendingChanges.current = {};
          } catch (error) {
            console.error('Error saving identity generator settings:', error);
            // Don't show alert when navigating away to avoid blocking navigation
          }
        };

        // Execute save without blocking navigation
        saveChanges();
      };
    }, [dbContext.sqliteClient, t, executeVaultMutation])
  );

  /**
   * Handle language change
   */
  const handleLanguageChange = useCallback((newLanguage: string): void => {
    setLanguage(newLanguage);
    pendingChanges.current.language = newLanguage;
  }, []);

  /**
   * Handle gender change
   */
  const handleGenderChange = useCallback((newGender: string): void => {
    setGender(newGender);
    pendingChanges.current.gender = newGender;
  }, []);

  /**
   * Handle age range change
   */
  const handleAgeRangeChange = useCallback((newAgeRange: string): void => {
    setAgeRange(newAgeRange);
    pendingChanges.current.ageRange = newAgeRange;
  }, []);

  const styles = StyleSheet.create({
    descriptionText: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 20,
    },
    headerText: {
      color: colors.textMuted,
      fontSize: 13,
      marginBottom: 8,
    },
    option: {
      alignItems: 'center',
      borderBottomColor: colors.accentBorder,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    optionContainer: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      marginTop: 8,
    },
    optionLast: {
      borderBottomWidth: 0,
    },
    optionText: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 8,
      marginTop: 16,
    },
    selectedIcon: {
      color: colors.primary,
      marginLeft: 8,
    },
  });

  return (
    <ThemedContainer>
      <ThemedScrollView>
        <ThemedText style={styles.headerText}>
          {t('settings.identityGeneratorSettings.description')}
        </ThemedText>

        <ThemedText style={styles.sectionTitle}>{t('settings.identityGeneratorSettings.languageSection')}</ThemedText>
        <ThemedText style={styles.descriptionText}>
          {t('settings.identityGeneratorSettings.languageDescription')}
        </ThemedText>
        <View style={styles.optionContainer}>
          {languageOptions.map((option, index) => {
            const isLast = index === languageOptions.length - 1;
            return (
              <TouchableOpacity
                key={option.value}
                style={[styles.option, isLast && styles.optionLast]}
                onPress={() => handleLanguageChange(option.value)}
              >
                <ThemedText style={styles.optionText}>{option.flag} {option.label}</ThemedText>
                {language === option.value && (
                  <Ionicons name="checkmark" size={20} style={styles.selectedIcon} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <ThemedText style={styles.sectionTitle}>{t('settings.identityGeneratorSettings.genderSection')}</ThemedText>
        <ThemedText style={styles.descriptionText}>
          {t('settings.identityGeneratorSettings.genderDescription')}
        </ThemedText>
        <View style={styles.optionContainer}>
          {GENDER_OPTIONS.map((option, index) => {
            const isLast = index === GENDER_OPTIONS.length - 1;
            return (
              <TouchableOpacity
                key={option.value}
                style={[styles.option, isLast && styles.optionLast]}
                onPress={() => handleGenderChange(option.value)}
              >
                <ThemedText style={styles.optionText}>{option.label}</ThemedText>
                {gender === option.value && (
                  <Ionicons name="checkmark" size={20} style={styles.selectedIcon} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <ThemedText style={styles.sectionTitle}>{t('settings.identityGeneratorSettings.ageRangeSection')}</ThemedText>
        <ThemedText style={styles.descriptionText}>
          {t('settings.identityGeneratorSettings.ageRangeDescription')}
        </ThemedText>
        <View style={styles.optionContainer}>
          {ageRangeOptions.map((option, index) => {
            const isLast = index === ageRangeOptions.length - 1;
            const displayLabel = option.value === 'random'
              ? t('settings.identityGeneratorSettings.genderOptions.random')
              : option.label;
            return (
              <TouchableOpacity
                key={option.value}
                style={[styles.option, isLast && styles.optionLast]}
                onPress={() => handleAgeRangeChange(option.value)}
              >
                <ThemedText style={styles.optionText}>{displayLabel}</ThemedText>
                {ageRange === option.value && (
                  <Ionicons name="checkmark" size={20} style={styles.selectedIcon} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </ThemedScrollView>
    </ThemedContainer>
  );
}