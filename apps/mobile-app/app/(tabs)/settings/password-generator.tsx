import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useFocusEffect } from 'expo-router';
import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, Alert, TouchableOpacity, Switch, Platform } from 'react-native';

import type { PasswordSettings } from '@/utils/dist/shared/models/vault';
import { CreatePasswordGenerator } from '@/utils/dist/shared/password-generator';

import { useColors } from '@/hooks/useColorScheme';
import { useVaultMutate } from '@/hooks/useVaultMutate';

import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { useDb } from '@/context/DbContext';

/**
 * Password Generator Settings screen.
 */
export default function PasswordGeneratorSettingsScreen(): React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const dbContext = useDb();
  const { executeVaultMutation } = useVaultMutate();

  const [settings, setSettings] = useState<PasswordSettings>({
    Length: 16,
    UseLowercase: true,
    UseUppercase: true,
    UseNumbers: true,
    UseSpecialChars: true,
    UseNonAmbiguousChars: false
  });
  const [previewPassword, setPreviewPassword] = useState<string>('');
  const [sliderValue, setSliderValue] = useState<number>(16);

  // Store pending changes and initial values
  const pendingChanges = useRef<Partial<PasswordSettings>>({});
  const initialValues = useRef<PasswordSettings>({
    Length: 16,
    UseLowercase: true,
    UseUppercase: true,
    UseNumbers: true,
    UseSpecialChars: true,
    UseNonAmbiguousChars: false
  });

  const handleRefreshPreview = useCallback(() => {
    try {
      const passwordGenerator = CreatePasswordGenerator(settings);
      const password = passwordGenerator.generateRandomPassword();
      setPreviewPassword(password);
    } catch (error) {
      console.error('Error generating password:', error);
    }
  }, [settings]);

  useFocusEffect(
    useCallback(() => {
      /**
       * Load the password generator settings on focus.
       */
      const loadSettings = async (): Promise<void> => {
        try {
          const passwordSettings = await dbContext.sqliteClient!.getPasswordSettings();

          setSettings(passwordSettings);
          setSliderValue(passwordSettings.Length);
          initialValues.current = passwordSettings;

          // Generate initial preview password only once
          try {
            const passwordGenerator = CreatePasswordGenerator(passwordSettings);
            const password = passwordGenerator.generateRandomPassword();
            setPreviewPassword(password);
          } catch (error) {
            console.error('Error generating initial password:', error);
            setPreviewPassword('');
          }

          // Clear pending changes when screen loads
          pendingChanges.current = {};
          console.debug('Settings loaded and initialized');
        } catch (error) {
          console.error('Error loading password generator settings:', error);
          Alert.alert(t('common.error'), t('common.unknownError'));
        }
      };

      loadSettings();

      // Save changes when screen loses focus (navigating away)
      return (): void => {
        /**
         * Save current settings to the database synchronously.
         */
        // Check if there are pending changes to save
        const hasChanges = Object.keys(pendingChanges.current).length > 0;
        console.debug('Screen losing focus. Pending changes:', pendingChanges.current, 'Has changes:', hasChanges);

        if (!hasChanges) {
          console.debug('No changes to save');
          return;
        }

        // Use the merged settings with all pending changes
        const finalSettings = { ...initialValues.current, ...pendingChanges.current };
        console.debug('Saving settings:', finalSettings);

        /*
         * Save settings synchronously to ensure they persist before navigation
         * We use a promise but don't await it to avoid blocking navigation
         */
        executeVaultMutation(async () => {
          // Save as JSON serialized object to match how getPasswordSettings reads it
          const settingsJson = JSON.stringify(finalSettings);
          await dbContext.sqliteClient!.updateSetting('PasswordGenerationSettings', settingsJson);
        }).then(() => {
          console.debug('Password generator settings saved successfully');
          // Update initial values after successful save
          initialValues.current = finalSettings;
          // Clear pending changes after successful save
          pendingChanges.current = {};
        }).catch((error) => {
          console.error('Error saving password generator settings:', error);
        });
      };
    }, [dbContext.sqliteClient, t, executeVaultMutation])
  );

  /**
   * Handle slider value change.
   */
  const handleSliderChange = useCallback((value: number): void => {
    const roundedLength = Math.round(value);
    setSliderValue(roundedLength);

    // Update settings and regenerate password immediately
    const newSettings = { ...settings, Length: roundedLength };
    setSettings(newSettings);

    // Track the change
    pendingChanges.current = { ...pendingChanges.current, Length: roundedLength };
    console.debug('Slider changed, pending changes:', pendingChanges.current);

    // Generate new preview password
    try {
      const passwordGenerator = CreatePasswordGenerator(newSettings);
      const password = passwordGenerator.generateRandomPassword();
      setPreviewPassword(password);
    } catch (error) {
      console.error('Error generating password:', error);
    }
  }, [settings]);

  /**
   * Update a boolean setting.
   */
  const updateSetting = useCallback((key: keyof PasswordSettings, value: boolean): void => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);

    // Track the change
    pendingChanges.current = { ...pendingChanges.current, [key]: value };
    console.debug(`Setting ${key} changed to ${value}, pending changes:`, pendingChanges.current);

    // Generate new preview password
    try {
      const passwordGenerator = CreatePasswordGenerator(newSettings);
      const password = passwordGenerator.generateRandomPassword();
      setPreviewPassword(password);
    } catch (error) {
      console.error('Error generating password:', error);
    }
  }, [settings]);

  const styles = StyleSheet.create({
    descriptionText: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 20,
      marginBottom: 16,
    },
    headerText: {
      color: colors.textMuted,
      fontSize: 13,
      marginBottom: 8,
    },
    previewContainer: {
      marginBottom: 20,
      marginTop: 16,
    },
    previewInput: {
      color: colors.text,
      flex: 1,
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
      fontSize: 14,
      padding: 12,
      textAlign: 'center',
    },
    previewInputContainer: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 6,
      borderWidth: 1,
      flexDirection: 'row',
    },
    previewLabel: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 8,
    },
    refreshButton: {
      borderLeftColor: colors.accentBorder,
      borderLeftWidth: 1,
      padding: 10,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 8,
      marginTop: 20,
    },
    settingItem: {
      alignItems: 'center',
      borderBottomColor: colors.accentBorder,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    settingItemLast: {
      borderBottomWidth: 0,
    },
    settingLabel: {
      color: colors.text,
      fontSize: 16,
      flex: 1,
    },
    settingsContainer: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      marginTop: 8,
    },
    slider: {
      height: 40,
      width: '100%',
    },
    sliderContainer: {
      flex: 1,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    sliderHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    sliderLabel: {
      color: colors.text,
      fontSize: 16,
    },
    sliderValue: {
      color: colors.primary,
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
      fontSize: 16,
      fontWeight: '600',
    },
  });

  return (
    <ThemedContainer>
      <ThemedScrollView>
        <ThemedText style={styles.headerText}>
          {t('settings.passwordGeneratorSettings.description')}
        </ThemedText>

        <View style={styles.previewContainer}>
          <ThemedText style={styles.previewLabel}>{t('settings.passwordGeneratorSettings.preview')}</ThemedText>
          <View style={styles.previewInputContainer}>
            <ThemedText style={styles.previewInput}>{previewPassword}</ThemedText>
            <TouchableOpacity
              style={styles.refreshButton}
              onPress={handleRefreshPreview}
              activeOpacity={0.7}
            >
              <Ionicons name="refresh" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.settingsContainer}>
          <View style={styles.sliderContainer}>
            <View style={styles.sliderHeader}>
              <ThemedText style={styles.sliderLabel}>{t('credentials.passwordLength')}</ThemedText>
              <ThemedText style={styles.sliderValue}>{sliderValue}</ThemedText>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={8}
              maximumValue={64}
              value={sliderValue}
              onValueChange={handleSliderChange}
              step={1}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.accentBorder}
              thumbTintColor={colors.primary}
            />
          </View>
        </View>

        <View style={styles.settingsContainer}>
          <View style={styles.settingItem}>
            <ThemedText style={styles.settingLabel}>{t('credentials.includeLowercase')}</ThemedText>
            <Switch
              value={settings.UseLowercase}
              onValueChange={(value) => updateSetting('UseLowercase', value)}
              trackColor={{ false: colors.accentBorder, true: colors.primary }}
              thumbColor={Platform.OS === 'android' ? colors.background : undefined}
            />
          </View>

          <View style={styles.settingItem}>
            <ThemedText style={styles.settingLabel}>{t('credentials.includeUppercase')}</ThemedText>
            <Switch
              value={settings.UseUppercase}
              onValueChange={(value) => updateSetting('UseUppercase', value)}
              trackColor={{ false: colors.accentBorder, true: colors.primary }}
              thumbColor={Platform.OS === 'android' ? colors.background : undefined}
            />
          </View>

          <View style={styles.settingItem}>
            <ThemedText style={styles.settingLabel}>{t('credentials.includeNumbers')}</ThemedText>
            <Switch
              value={settings.UseNumbers}
              onValueChange={(value) => updateSetting('UseNumbers', value)}
              trackColor={{ false: colors.accentBorder, true: colors.primary }}
              thumbColor={Platform.OS === 'android' ? colors.background : undefined}
            />
          </View>

          <View style={styles.settingItem}>
            <ThemedText style={styles.settingLabel}>{t('credentials.includeSpecialChars')}</ThemedText>
            <Switch
              value={settings.UseSpecialChars}
              onValueChange={(value) => updateSetting('UseSpecialChars', value)}
              trackColor={{ false: colors.accentBorder, true: colors.primary }}
              thumbColor={Platform.OS === 'android' ? colors.background : undefined}
            />
          </View>

          <View style={[styles.settingItem, styles.settingItemLast]}>
            <ThemedText style={styles.settingLabel}>{t('credentials.avoidAmbiguousChars')}</ThemedText>
            <Switch
              value={settings.UseNonAmbiguousChars}
              onValueChange={(value) => updateSetting('UseNonAmbiguousChars', value)}
              trackColor={{ false: colors.accentBorder, true: colors.primary }}
              thumbColor={Platform.OS === 'android' ? colors.background : undefined}
            />
          </View>
        </View>
      </ThemedScrollView>
    </ThemedContainer>
  );
}