import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, TouchableOpacity, Linking, Switch } from 'react-native';
import { useState, useEffect } from 'react';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { useAuth } from '@/context/AuthContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Android autofill screen.
 */
export default function AndroidAutofillScreen() : React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const { markAutofillConfigured, shouldShowAutofillReminder } = useAuth();
  const [advancedOptionsExpanded, setAdvancedOptionsExpanded] = useState(false);
  const [showSearchText, setShowSearchText] = useState(false);

  /**
   * Load the show search text setting on mount.
   */
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const value = await NativeVaultManager.getAutofillShowSearchText();
        setShowSearchText(value);
      } catch (err) {
        console.warn('Failed to load autofill settings:', err);
      }
    };
    loadSettings();
  }, []);

  /**
   * Handle the configure press.
   */
  const handleConfigurePress = async () : Promise<void> => {
    await markAutofillConfigured();
    try {
      await NativeVaultManager.openAutofillSettingsPage();
    } catch (err) {
      console.warn('Failed to open settings:', err);
    }
  };

  /**
   * Handle the already configured press.
   */
  const handleAlreadyConfigured = async () : Promise<void> => {
    await markAutofillConfigured();
    router.back();
  };

  /**
   * Handle opening the documentation link.
   */
  const handleOpenDocs = () : void => {
    Linking.openURL('https://docs.aliasvault.net/mobile-apps/android/autofill.html');
  };

  /**
   * Handle toggling the show search text setting.
   */
  const handleToggleShowSearchText = async (value: boolean) : Promise<void> => {
    try {
      await NativeVaultManager.setAutofillShowSearchText(value);
      setShowSearchText(value);
    } catch (err) {
      console.warn('Failed to update show search text setting:', err);
    }
  };

  const styles = StyleSheet.create({
    advancedOptionsContainer: {
      marginTop: 16,
      paddingBottom: 16,
    },
    advancedOptionsDescription: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
      marginBottom: 8,
    },
    advancedOptionsHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    advancedOptionsTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    advancedOptionsToggle: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderRadius: 8,
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 16,
      padding: 16,
    },
    advancedOptionsToggleContainer: {
      flex: 1,
      marginRight: 12,
    },
    advancedOptionsToggleHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      paddingVertical: 8,
    },
    advancedOptionsToggleText: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '500',
    },
    buttonContainer: {
      padding: 16,
      paddingBottom: 16,
    },
    chevron: {
      color: colors.textMuted,
      fontSize: 20,
    },
    configureButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 16,
    },
    configureButtonText: {
      color: colors.primarySurfaceText,
      fontSize: 16,
      fontWeight: '600',
    },
    headerText: {
      color: colors.textMuted,
      fontSize: 13,
    },
    instructionContainer: {
      paddingTop: 16,
    },
    instructionStep: {
      color: colors.text,
      fontSize: 15,
      lineHeight: 22,
      marginBottom: 8,
    },
    instructionTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '600',
      marginBottom: 8,
    },
    secondaryButton: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      marginTop: 12,
      paddingVertical: 16,
    },
    secondaryButtonText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
    settingRow: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 12,
      padding: 16,
    },
    settingRowDescription: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 4,
    },
    settingRowText: {
      color: colors.text,
      flex: 1,
      marginRight: 12,
    },
    settingRowTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '500',
    },
    tipStep: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 20,
      marginTop: 8,
    },
    warningContainer: {
      backgroundColor: colors.accentBackground,
      marginBottom: 16,
      padding: 16,
    },
    warningDescription: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
    },
    warningLink: {
      color: colors.primary,
      fontSize: 14,
      textDecorationLine: 'underline',
    },
    warningTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 8,
    },
  });

  return (
    <ThemedContainer>
      <ThemedScrollView>
        <View style={styles.warningContainer}>
          <ThemedText style={styles.warningTitle}>{t('settings.androidAutofillSettings.warningTitle')}</ThemedText>
          <ThemedText style={styles.warningDescription}>
            {t('settings.androidAutofillSettings.warningDescription')}{' '}
            <ThemedText style={styles.warningLink} onPress={handleOpenDocs}>
              {t('settings.androidAutofillSettings.warningLink')}
            </ThemedText>
          </ThemedText>
        </View>

        <View>
          <ThemedText style={styles.headerText}>
            {t('settings.androidAutofillSettings.headerText')}
          </ThemedText>
        </View>

        <View style={styles.instructionContainer}>
          <ThemedText style={styles.instructionTitle}>{t('settings.androidAutofillSettings.howToEnable')}</ThemedText>
          <ThemedText style={styles.instructionStep}>
            {t('settings.androidAutofillSettings.step1')}
          </ThemedText>
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={styles.configureButton}
              onPress={handleConfigurePress}
            >
              <ThemedText style={styles.configureButtonText}>
                {t('settings.androidAutofillSettings.openAutofillSettings')}
              </ThemedText>
            </TouchableOpacity>
            <ThemedText style={styles.tipStep}>
              {t('settings.androidAutofillSettings.buttonTip')}
            </ThemedText>
          </View>
          <ThemedText style={styles.instructionStep}>
            {t('settings.androidAutofillSettings.step2')}
          </ThemedText>
          <View style={styles.buttonContainer}>
            {shouldShowAutofillReminder && (
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={handleAlreadyConfigured}
              >
                <ThemedText style={styles.secondaryButtonText}>
                  {t('settings.androidAutofillSettings.alreadyConfigured')}
                </ThemedText>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={styles.advancedOptionsContainer}>
          <TouchableOpacity
            style={styles.advancedOptionsToggleHeader}
            onPress={() => setAdvancedOptionsExpanded(!advancedOptionsExpanded)}
          >
            <ThemedText style={styles.advancedOptionsTitle}>
              {t('settings.androidAutofillSettings.advancedOptions')}
            </ThemedText>
            <ThemedText style={styles.chevron}>
              {advancedOptionsExpanded ? '▼' : '▶'}
            </ThemedText>
          </TouchableOpacity>

          {advancedOptionsExpanded && (
            <View>
              <View style={styles.settingRow}>
                <View style={styles.settingRowText}>
                  <ThemedText style={styles.settingRowTitle}>
                    {t('settings.androidAutofillSettings.showSearchText')}
                  </ThemedText>
                  <ThemedText style={styles.settingRowDescription}>
                    {t('settings.androidAutofillSettings.showSearchTextDescription')}
                  </ThemedText>
                </View>
                <Switch
                  value={showSearchText}
                  onValueChange={handleToggleShowSearchText}
                  trackColor={{ false: colors.accentBackground, true: colors.primary }}
                  thumbColor={colors.primarySurfaceText}
                />
              </View>
            </View>
          )}
        </View>
      </ThemedScrollView>
    </ThemedContainer>
  );
}