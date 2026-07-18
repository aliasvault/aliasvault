import { useFocusEffect } from 'expo-router';
import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import type { PasswordSettings } from '@/utils/dist/core/models/vault';

import { useColors } from '@/hooks/useColorScheme';
import { useVaultMutate } from '@/hooks/useVaultMutate';

import { PasswordGeneratorPanel } from '@/components/form/PasswordGeneratorPanel';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { useDb } from '@/context/DbContext';
import { useDialog } from '@/context/DialogContext';

/**
 * Password Generator Settings screen. Configures the default password and passphrase generator
 * settings, persisted globally in the vault so they sync across AliasVault clients.
 */
export default function PasswordGeneratorSettingsScreen(): React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const dbContext = useDb();
  const { showAlert } = useDialog();
  const { executeVaultMutation } = useVaultMutate();

  const [settings, setSettings] = useState<PasswordSettings | null>(null);
  // Increments each time settings are (re)loaded so the panel remounts with fresh initial values.
  const [loadKey, setLoadKey] = useState(0);

  // Latest settings and the last persisted snapshot, used to persist on blur only when changed.
  const latestSettings = useRef<PasswordSettings | null>(null);
  const persistedJson = useRef<string>('');

  useFocusEffect(
    useCallback(() => {
      /**
       * Load the password generator settings on focus.
       */
      const loadSettings = async (): Promise<void> => {
        try {
          const passwordSettings = await dbContext.sqliteClient!.getPasswordSettings();
          setSettings(passwordSettings);
          latestSettings.current = passwordSettings;
          persistedJson.current = JSON.stringify(passwordSettings);
          setLoadKey((key) => key + 1);
        } catch (error) {
          console.error('Error loading password generator settings:', error);
          showAlert(t('common.error'), t('common.errors.unknownError'));
        }
      };

      loadSettings();

      // Persist changes when the screen loses focus (navigating away).
      return (): void => {
        const current = latestSettings.current;
        if (!current) {
          return;
        }
        const currentJson = JSON.stringify(current);
        if (currentJson === persistedJson.current) {
          return;
        }

        executeVaultMutation(async () => {
          await dbContext.sqliteClient!.updateSetting('PasswordGenerationSettings', currentJson);
        }).then(() => {
          persistedJson.current = currentJson;
        }).catch((error) => {
          console.error('Error saving password generator settings:', error);
        });
      };
    }, [dbContext.sqliteClient, showAlert, t, executeVaultMutation])
  );

  const handleSettingsChange = useCallback((newSettings: PasswordSettings): void => {
    latestSettings.current = newSettings;
  }, []);

  const styles = StyleSheet.create({
    descriptionText: {
      color: colors.textMuted,
      fontSize: 13,
      marginBottom: 16,
    },
  });

  if (!settings) {
    return (
      <ThemedContainer>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ThemedText>{t('common.loading')}</ThemedText>
        </View>
      </ThemedContainer>
    );
  }

  return (
    <ThemedContainer>
      <ThemedScrollView>
        <ThemedText style={styles.descriptionText}>
          {t('settings.passwordGeneratorSettings.description')}
        </ThemedText>
        <PasswordGeneratorPanel
          key={loadKey}
          initialSettings={settings}
          onSettingsChange={handleSettingsChange}
        />
      </ThemedScrollView>
    </ThemedContainer>
  );
}
