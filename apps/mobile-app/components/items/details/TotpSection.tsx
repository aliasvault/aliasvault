import React, { useState, useEffect } from 'react';

import { generateTotpCode } from '@/utils/TotpUtility';
import { useTranslation } from 'react-i18next';
import { View, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import Toast from 'react-native-toast-message';

import { copyToClipboardWithExpiration } from '@/utils/ClipboardUtility';
import type { Item, TotpCode } from '@/utils/dist/core/models/vault';

import { useColors } from '@/hooks/useColorScheme';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { useDb } from '@/context/DbContext';
import { LocalPreferencesService } from '@/services/LocalPreferencesService';

/**
 * Formats a TOTP code as "XXX XXX" with a space in the middle for better readability.
 */
const formatTotpCode = (code: string | undefined): string => {
  if (!code) {
    return '';
  }
  if (code.length === 6) {
    return `${code.slice(0, 3)} ${code.slice(3)}`;
  }
  return code;
};

type TotpSectionProps = {
  item: Item;
};

/**
 * Totp section component.
 */
export const TotpSection: React.FC<TotpSectionProps> = ({ item }) : React.ReactNode => {
  const [totpCodes, setTotpCodes] = useState<TotpCode[]>([]);
  const [currentCodes, setCurrentCodes] = useState<Record<string, string>>({});
  const colors = useColors();
  const dbContext = useDb();
  const { t } = useTranslation();

  /**
   * Get the remaining seconds in the current TOTP window.
   */
  const getRemainingSeconds = (step = 30): number => {
    return step - (Math.floor(Date.now() / 1000) % step);
  };

  /**
   * Get the remaining percentage.
   */
  const getRemainingPercentage = (): number => {
    const remaining = getRemainingSeconds();
    return Math.floor(((30.0 - remaining) / 30.0) * 100);
  };

  /**
   * Copy the totp code to the clipboard.
   */
  const copyToClipboardWithClear = async (code: string): Promise<void> => {
    try {
      // Get clipboard clear timeout from settings
      const timeoutSeconds = await LocalPreferencesService.getClipboardClearTimeout();

      // Use centralized clipboard utility
      await copyToClipboardWithExpiration(code, timeoutSeconds);

      if (Platform.OS !== 'android') {
        // Only show toast on iOS, Android already shows a native toast on clipboard interactions.
        Toast.show({
          type: 'success',
          text1: t('common.copied'),
          position: 'bottom',
          visibilityTime: 2000,
        });
      }
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  useEffect(() => {
    /**
     * Load the totp codes.
     */
    const loadTotpCodes = async () : Promise<void> => {
      if (!dbContext?.sqliteClient) {
        return;
      }

      try {
        const codes = await dbContext.sqliteClient.settings.getTotpCodesForItem(item.Id);
        setTotpCodes(codes);
      } catch (error) {
        console.error('Error loading TOTP codes:', error);
      }
    };

    loadTotpCodes();
  }, [item, dbContext?.sqliteClient]);

  useEffect(() => {
    let cancelled = false;

    /**
     * Generate codes for all current TOTP entries via the native bridge and
     * push them into state. Falls back to "Error" only when no previous code
     * exists for that entry, so the display doesn't flicker when a single
     * tick fails.
     */
    const refreshCodes = async () : Promise<void> => {
      const results = await Promise.all(
        totpCodes.map(async (code) => ({
          id: code.Id,
          value: await generateTotpCode(code.SecretKey),
        }))
      );
      if (cancelled) return;
      setCurrentCodes(prev => {
        const next: Record<string, string> = {};
        for (const { id, value } of results) {
          next[id] = value || prev[id] || 'Error';
        }
        return next;
      });
    };

    refreshCodes();
    const intervalId = setInterval(refreshCodes, 1000);

    return () : void => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [totpCodes]);

  if (totpCodes.length === 0) {
    return null;
  }

  const styles = StyleSheet.create({
    code: {
      fontSize: 24,
      fontWeight: 'bold',
      letterSpacing: 2,
    },
    codeContainer: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    container: {
      paddingTop: 16,
    },
    content: {
      backgroundColor: colors.accentBackground,
      borderRadius: 8,
      marginTop: 8,
      padding: 12,
    },
    label: {
      fontSize: 12,
      marginBottom: 4,
    },
    progressBar: {
      backgroundColor: colors.primary,
      borderRadius: 2,
      height: 4,
      overflow: 'hidden',
      width: 40,
    },
    progressFill: {
      backgroundColor: colors.secondary,
      height: '100%',
    },
    timer: {
      fontSize: 12,
      marginBottom: 4,
    },
    timerContainer: {
      alignItems: 'flex-end',
    },
  });

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="subtitle">
        {t('common.twoFactorAuthentication')}
      </ThemedText>
      {totpCodes.map(totpCode => (
        <TouchableOpacity
          key={totpCode.Id}
          style={styles.content}
          onPress={() => copyToClipboardWithClear(currentCodes[totpCode.Id])}
        >
          <View style={styles.codeContainer}>
            <View>
              <ThemedText style={styles.label}>
                {totpCode.Name || t('totp.defaultName')}
              </ThemedText>
              <ThemedText style={styles.code}>
                {formatTotpCode(currentCodes[totpCode.Id])}
              </ThemedText>
            </View>
            <View style={styles.timerContainer}>
              <ThemedText style={styles.timer}>
                {getRemainingSeconds()}s
              </ThemedText>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${getRemainingPercentage()}%` }
                  ]}
                />
              </View>
            </View>
          </View>
        </TouchableOpacity>
      ))}
    </ThemedView>
  );
};
