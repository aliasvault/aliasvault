import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, TouchableOpacity } from 'react-native';

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

  const styles = StyleSheet.create({
    buttonContainer: {
      padding: 16,
      paddingBottom: 32,
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
    warningText: {
      color: colors.textMuted,
      fontSize: 15,
      fontStyle: 'italic',
      marginTop: 8,
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
          <ThemedText style={styles.instructionTitle}>{t('settings.iosAutofillSettings.howToEnable')}</ThemedText>
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
          <ThemedText style={styles.warningText}>
            {t('settings.iosAutofillSettings.warningText')}
          </ThemedText>
          <View style={styles.buttonContainer}>
            {shouldShowAutofillReminder && (
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={handleAlreadyConfigured}
              >
                <ThemedText style={styles.secondaryButtonText}>
                  {t('settings.iosAutofillSettings.alreadyConfigured')}
                </ThemedText>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </ThemedScrollView>
    </ThemedContainer>
  );
}