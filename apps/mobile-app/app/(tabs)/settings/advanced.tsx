import { useState, useEffect } from 'react';
import { StyleSheet, View, Switch } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Advanced settings screen.
 */
export default function AdvancedSettingsScreen(): React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<boolean>(true);

  useEffect(() => {
    /**
     * Load the current preference, which the native layer stores and applies.
     */
    const loadPreference = async (): Promise<void> => {
      setEnabled(await NativeVaultManager.getScreenCaptureProtection());
    };

    loadPreference();
  }, []);

  /**
   * Handle the toggle.
   */
  const handleChange = async (value: boolean): Promise<void> => {
    setEnabled(value);
    await NativeVaultManager.setScreenCaptureProtection(value);
  };

  const styles = StyleSheet.create({
    headerText: {
      color: colors.textMuted,
      fontSize: 13,
    },
    optionContainer: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      marginTop: 16,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    optionRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    optionText: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
    },
  });

  return (
    <ThemedContainer>
      <ThemedScrollView>
        <ThemedText style={styles.headerText}>
          {t('settings.hideAppContentsDescription')}
        </ThemedText>
        <View style={styles.optionContainer}>
          <View style={styles.optionRow}>
            <ThemedText style={styles.optionText}>{t('settings.hideAppContents')}</ThemedText>
            <Switch
              testID="hide-app-contents-switch"
              value={enabled}
              onValueChange={handleChange}
              trackColor={{ false: colors.accentBorder, true: colors.primary }}
              thumbColor={colors.primarySurfaceText}
            />
          </View>
        </View>
      </ThemedScrollView>
    </ThemedContainer>
  );
}
