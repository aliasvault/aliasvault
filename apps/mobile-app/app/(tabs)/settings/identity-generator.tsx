import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, TouchableOpacity } from 'react-native';

import { getAvailableAgeRanges, IAgeRangeOption, getAvailableLanguages, ILanguageOption } from '@/utils/dist/core/identity-generator';

import { useColors } from '@/hooks/useColorScheme';
import { useVaultMutate } from '@/hooks/useVaultMutate';

import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { useDb } from '@/context/DbContext';
import { useDialog } from '@/context/DialogContext';

/**
 * Identity Generator Settings screen.
 */
export default function IdentityGeneratorSettingsScreen(): React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const router = useRouter();
  const dbContext = useDb();
  const { showAlert } = useDialog();
  const { executeVaultMutation } = useVaultMutate();

  const [language, setLanguage] = useState<string>('en');
  const [gender, setGender] = useState<string>('random');
  const [ageRange, setAgeRange] = useState<string>('random');
  const [languageOptions, setLanguageOptions] = useState<ILanguageOption[]>([]);
  const [ageRangeOptions, setAgeRangeOptions] = useState<IAgeRangeOption[]>([]);

  // Store pending changes and initial values (language is managed in subview)
  const pendingChanges = useRef<{ gender?: string; ageRange?: string }>({});
  const initialValues = useRef<{ gender: string; ageRange: string }>({ gender: 'random', ageRange: 'random' });

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
            dbContext.sqliteClient!.getEffectiveIdentityLanguage(),
            dbContext.sqliteClient!.getDefaultIdentityGender(),
            dbContext.sqliteClient!.getDefaultIdentityAgeRange()
          ]);

          setLanguage(currentLanguage);
          setGender(currentGender);
          setAgeRange(currentAgeRange);
          // Store initial values (language is managed in subview)
          initialValues.current = { gender: currentGender, ageRange: currentAgeRange };
          // Clear pending changes when screen loads
          pendingChanges.current = {};
        } catch (error) {
          console.error('Error loading identity generator settings:', error);
          showAlert(t('common.error'), t('common.errors.unknownError'));
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
            // Save all pending changes in a single vault mutation (language is managed in subview)
            await executeVaultMutation(async () => {
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
    }, [dbContext.sqliteClient, showAlert, t, executeVaultMutation])
  );

  /**
   * Navigate to language selection subview
   */
  const handleLanguagePress = useCallback((): void => {
    router.push('/(tabs)/settings/identity-generator-language');
  }, [router]);

  /**
   * Get the display label for the current language
   */
  const getLanguageDisplayLabel = useCallback((): string => {
    const option = languageOptions.find(opt => opt.value === language);
    return option ? `${option.flag} ${option.label}` : language;
  }, [language, languageOptions]);

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
    chevron: {
      color: colors.textMuted,
      marginLeft: 8,
    },
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
    navRow: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      flexDirection: 'row',
      marginTop: 8,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    navRowLabel: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
    },
    navRowValue: {
      color: colors.textMuted,
      fontSize: 16,
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
        <TouchableOpacity style={styles.navRow} onPress={handleLanguagePress}>
          <ThemedText style={styles.navRowLabel}>{t('settings.identityGeneratorSettings.languageSection')}</ThemedText>
          <ThemedText style={styles.navRowValue}>{getLanguageDisplayLabel()}</ThemedText>
          <Ionicons name="chevron-forward" size={20} style={styles.chevron} />
        </TouchableOpacity>

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