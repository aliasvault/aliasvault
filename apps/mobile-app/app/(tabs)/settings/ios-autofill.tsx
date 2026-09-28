import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, TouchableOpacity, Switch } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { useAuth } from '@/context/AuthContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * iOS autofill screen.
 */
export default function IosAutofillScreen() : React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const { markAutofillConfigured, shouldShowAutofillReminder } = useAuth();
  const [advancedOptionsExpanded, setAdvancedOptionsExpanded] = useState(false);
  const [copyTotpOnFill, setCopyTotpOnFill] = useState(true);

  /**
   * Load native autofill toggle settings on mount.
   */
  useEffect(() => {
    /**
     * Read the persisted copy-TOTP-on-fill setting.
     */
    const loadSettings = async () : Promise<void> => {
      try {
        const value = await NativeVaultManager.getAutofillCopyTotpOnFill();
        setCopyTotpOnFill(value);
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
   * Handle toggling the copy-TOTP-on-fill setting.
   */
  const handleToggleCopyTotpOnFill = async (value: boolean) : Promise<void> => {
    try {
      await NativeVaultManager.setAutofillCopyTotpOnFill(value);
      setCopyTotpOnFill(value);
    } catch (err) {
      console.warn('Failed to update copy-TOTP-on-fill setting:', err);
    }
  };

  const styles = StyleSheet.create({
    advancedOptionsContainer: {
      marginTop: 16,
      paddingBottom: 16,
    },
    advancedOptionsTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    advancedOptionsToggleHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 8,
    },
    buttonContainer: {
      padding: 16,
      paddingBottom: 32,
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
      textAlignVertical: 'top',
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
    noticeBox: {
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderLeftWidth: 4,
      borderRadius: 8,
      marginBottom: 16,
      marginTop: 8,
      padding: 12,
    },
    noticeText: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
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
  });

  return (
    <ThemedContainer>
      <ThemedScrollView>
        <ThemedText style={styles.headerText}>
          {t('settings.iosAutofillSettings.headerText')}
        </ThemedText>

        <View style={styles.noticeBox}>
          <ThemedText style={styles.noticeText}>
            {t('settings.iosAutofillSettings.passkeyNotice')}
          </ThemedText>
        </View>

        <View style={styles.instructionContainer}>
          <ThemedText style={styles.instructionTitle}>{t('settings.autofillSetup.howToEnable')}</ThemedText>
          <ThemedText style={styles.instructionStep}>
            {t('settings.iosAutofillSettings.step1')}
          </ThemedText>
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={styles.configureButton}
              onPress={handleConfigurePress}
            >
              <ThemedText style={styles.configureButtonText}>
                {t('settings.iosAutofillSettings.openIosSettings')}
              </ThemedText>
            </TouchableOpacity>
          </View>
          <ThemedText style={styles.instructionStep}>
            {t('settings.iosAutofillSettings.step2')}
          </ThemedText>
          <ThemedText style={styles.instructionStep}>
            {t('settings.iosAutofillSettings.step3')}
          </ThemedText>
          <ThemedText style={styles.instructionStep}>
            {t('settings.iosAutofillSettings.step4')}
          </ThemedText>
          <ThemedText style={styles.instructionStep}>
            {t('settings.iosAutofillSettings.step5')}
          </ThemedText>
          {shouldShowAutofillReminder && (
            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={handleAlreadyConfigured}
              >
                <ThemedText style={styles.secondaryButtonText}>
                  {t('settings.autofillSetup.alreadyConfigured')}
                </ThemedText>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.advancedOptionsContainer}>
          <TouchableOpacity
            style={styles.advancedOptionsToggleHeader}
            onPress={() => setAdvancedOptionsExpanded(!advancedOptionsExpanded)}
          >
            <ThemedText style={styles.advancedOptionsTitle}>
              {t('settings.advancedOptions')}
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
                    {t('settings.copyTotpOnFill')}
                  </ThemedText>
                  <ThemedText style={styles.settingRowDescription}>
                    {t('settings.copyTotpOnFillDescription')}
                  </ThemedText>
                </View>
                <Switch
                  value={copyTotpOnFill}
                  onValueChange={handleToggleCopyTotpOnFill}
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
