import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, TouchableOpacity } from 'react-native';

import { getAvailableLanguages, ILanguageOption } from '@/utils/dist/core/identity-generator';

import { useColors } from '@/hooks/useColorScheme';
import { useVaultMutate } from '@/hooks/useVaultMutate';

import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { useDb } from '@/context/DbContext';
import { useDialog } from '@/context/DialogContext';

/**
 * Identity Generator Language Selection screen.
 * Allows users to select the language used for generating identities.
 */
export default function IdentityGeneratorLanguageScreen(): React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const router = useRouter();
  const dbContext = useDb();
  const { showAlert } = useDialog();
  const { executeVaultMutation } = useVaultMutate();

  const [language, setLanguage] = useState<string>('en');
  const [languageOptions, setLanguageOptions] = useState<ILanguageOption[]>([]);

  // Store pending changes and initial values
  const pendingChanges = useRef<{ language?: string }>({});
  const initialValue = useRef<string>('en');

  // Load available languages on mount
  useEffect(() => {
    const languages = getAvailableLanguages();
    setLanguageOptions(languages);
  }, []);

  useFocusEffect(
    useCallback(() => {
      /**
       * Load the current language setting on focus.
       */
      const loadSettings = async (): Promise<void> => {
        try {
          const currentLanguage = await dbContext.sqliteClient!.getEffectiveIdentityLanguage();
          setLanguage(currentLanguage);
          initialValue.current = currentLanguage;
          pendingChanges.current = {};
        } catch (error) {
          console.error('Error loading identity generator language:', error);
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
          if (pendingChanges.current.language === undefined) {
            return;
          }

          try {
            await executeVaultMutation(async () => {
              await dbContext.sqliteClient!.updateSetting('DefaultIdentityLanguage', pendingChanges.current.language!);
            });
            pendingChanges.current = {};
          } catch (error) {
            console.error('Error saving identity generator language:', error);
          }
        };

        saveChanges();
      };
    }, [dbContext.sqliteClient, showAlert, t, executeVaultMutation])
  );

  /**
   * Handle language selection
   */
  const handleLanguageSelect = useCallback((newLanguage: string): void => {
    setLanguage(newLanguage);
    pendingChanges.current.language = newLanguage;
    // Navigate back after selection
    router.back();
  }, [router]);

  const styles = StyleSheet.create({
    descriptionText: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 20,
      marginBottom: 16,
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
    },
    optionLast: {
      borderBottomWidth: 0,
    },
    optionText: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
    },
    selectedIcon: {
      color: colors.primary,
      marginLeft: 8,
    },
  });

  return (
    <ThemedContainer>
      <ThemedScrollView>
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
                onPress={() => handleLanguageSelect(option.value)}
              >
                <ThemedText style={styles.optionText}>{option.flag} {option.label}</ThemedText>
                {language === option.value && (
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
