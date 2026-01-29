import { Ionicons } from '@expo/vector-icons';
import { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, Platform, AppState } from 'react-native';

import { useColors } from '@/hooks/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';

import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { useAuth } from '@/context/AuthContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Clipboard clear settings screen.
 */
export default function ClipboardClearScreen(): React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();

  const TIMEOUT_OPTIONS = [
    { value: 0, label: t('settings.clipboardClearOptions.never') },
    { value: 5, label: t('settings.clipboardClearOptions.5seconds') },
    { value: 10, label: t('settings.clipboardClearOptions.10seconds') },
    { value: 15, label: t('settings.clipboardClearOptions.15seconds') },
    { value: 30, label: t('settings.clipboardClearOptions.30seconds') },
  ];
  const { getClipboardClearTimeout, setClipboardClearTimeout } = useAuth();
  const [selectedTimeout, setSelectedTimeout] = useState<number>(10);
  const [isIgnoringBatteryOptimizations, setIsIgnoringBatteryOptimizations] = useState<boolean>(true);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    /**
     * Load the current clipboard clear timeout.
     */
    const loadCurrentTimeout = async (): Promise<void> => {
      const timeout = await getClipboardClearTimeout();
      setSelectedTimeout(timeout);
    };

    /**
     * Check battery optimization exemption status on Android.
     */
    const checkBatteryOptimization = async (): Promise<void> => {
      if (Platform.OS === 'android') {
        try {
          const isIgnoring = await NativeVaultManager.isIgnoringBatteryOptimizations();
          setIsIgnoringBatteryOptimizations(isIgnoring);
        } catch (error) {
          console.error('Error checking battery optimization status:', error);
          // Default to true to avoid showing the help section unnecessarily
          setIsIgnoringBatteryOptimizations(true);
        }
      }
    };

    loadCurrentTimeout();
    checkBatteryOptimization();

    // Listen for app state changes to re-check permission when app comes to foreground
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        // App coming to foreground, re-check battery optimization
        if (Platform.OS === 'android') {
          await checkBatteryOptimization();
        }
      }
      appState.current = nextAppState;
    });

    return (): void => {
      subscription.remove();
    };
  }, [getClipboardClearTimeout]);

  /**
   * Handle timeout change.
   */
  const handleTimeoutChange = async (timeout: number): Promise<void> => {
    await setClipboardClearTimeout(timeout);
    setSelectedTimeout(timeout);
  };

  /**
   * Handle battery optimization exemption request.
   */
  const handleRequestBatteryOptimizationExemption = async (): Promise<void> => {
    if (Platform.OS !== 'android') {
      return;
    }

    try {
      await NativeVaultManager.requestIgnoreBatteryOptimizations();
    } catch (error) {
      console.error('Error handling battery optimization exemption request:', error);
    }
  };

  const styles = StyleSheet.create({
    headerText: {
      color: colors.textMuted,
      fontSize: 13,
    },
    helpButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 8,
      flexDirection: 'row',
      justifyContent: 'center',
      paddingVertical: 12,
    },
    helpButtonText: {
      color: colors.background,
      fontSize: 14,
      fontWeight: '600',
      marginLeft: 8,
    },
    helpContainer: {
      backgroundColor: colors.accentBackground,
      borderRadius: 10,
      marginTop: 16,
      padding: 16,
    },
    helpDescription: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 20,
      marginBottom: 12,
    },
    helpTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
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
      marginTop: 16,
    },
    optionLast: {
      borderBottomWidth: 0,
    },
    optionText: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
    },
    permissionDenied: {
      color: colors.destructive || '#EF4444',
    },
    permissionGranted: {
      color: colors.success || '#10B981',
    },
    permissionStatusContainer: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    permissionStatusText: {
      fontSize: 13,
      marginLeft: 8,
    },
    selectedIcon: {
      color: colors.primary,
      marginLeft: 8,
    },
    warningContainer: {
      marginTop: 16,
    },
    warningDescription: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 20,
    },
  });

  return (
    <ThemedContainer>
      <ThemedScrollView>
        <ThemedText style={styles.headerText}>
          {t('settings.clipboardClearDescription')}
        </ThemedText>
        <View style={styles.optionContainer}>
          {TIMEOUT_OPTIONS.map((option, index) => {
            const isLast = index === TIMEOUT_OPTIONS.length - 1;
            return (
              <TouchableOpacity
                key={option.value}
                style={[styles.option, isLast && styles.optionLast]}
                onPress={() => handleTimeoutChange(option.value)}
              >
                <ThemedText style={styles.optionText}>{option.label}</ThemedText>
                {selectedTimeout === option.value && (
                  <Ionicons name="checkmark" size={20} style={styles.selectedIcon} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
        {Platform.OS === 'android' && (
          <View style={styles.warningContainer}>
            <ThemedText style={styles.warningDescription}>
              {t('settings.clipboardClearAndroidWarning')}
            </ThemedText>
          </View>
        )}
        {Platform.OS === 'android' && !isIgnoringBatteryOptimizations && selectedTimeout > 0 && (
          <View style={styles.helpContainer}>
            <ThemedText style={styles.helpTitle}>
              {t('settings.batteryOptimizationHelpTitle')}
            </ThemedText>
            <View style={styles.permissionStatusContainer}>
              <Ionicons
                name="warning"
                size={16}
                color={colors.destructive || '#EF4444'}
              />
              <ThemedText style={[styles.permissionStatusText, styles.permissionDenied]}>
                {t('settings.batteryOptimizationActive')}
              </ThemedText>
            </View>
            <ThemedText style={styles.helpDescription}>
              {t('settings.batteryOptimizationHelpDescription')}
            </ThemedText>
            <TouchableOpacity
              style={styles.helpButton}
              onPress={handleRequestBatteryOptimizationExemption}
            >
              <Ionicons name="battery-charging" size={16} color={colors.background} />
              <ThemedText style={styles.helpButtonText}>
                {t('settings.disableBatteryOptimization')}
              </ThemedText>
            </TouchableOpacity>
          </View>
        )}
        {Platform.OS === 'android' && isIgnoringBatteryOptimizations && selectedTimeout > 0 && (
          <View style={styles.helpContainer}>
            <View style={styles.permissionStatusContainer}>
              <Ionicons
                name="checkmark-circle"
                size={16}
                color={colors.success || '#10B981'}
              />
              <ThemedText style={[styles.permissionStatusText, styles.permissionGranted]}>
                {t('settings.batteryOptimizationDisabled')}
              </ThemedText>
            </View>
          </View>
        )}
      </ThemedScrollView>
    </ThemedContainer>
  );
}