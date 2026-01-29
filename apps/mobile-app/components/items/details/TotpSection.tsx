import * as OTPAuth from 'otpauth';
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import Toast from 'react-native-toast-message';

import { copyToClipboardWithExpiration } from '@/utils/ClipboardUtility';
import type { Item, TotpCode } from '@/utils/dist/core/models/vault';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { useAuth } from '@/context/AuthContext';
import { useDb } from '@/context/DbContext';

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
  const { getClipboardClearTimeout } = useAuth();

  /**
   * Get the remaining seconds.
   */
  const getRemainingSeconds = (step = 30): number => {
    const totp = new OTPAuth.TOTP({
      secret: 'dummy',
      algorithm: 'SHA1',
      digits: 6,
      period: step
    });
    return totp.period - (Math.floor(Date.now() / 1000) % totp.period);
  };

  /**
   * Get the remaining percentage.
   */
  const getRemainingPercentage = (): number => {
    const remaining = getRemainingSeconds();
    return Math.floor(((30.0 - remaining) / 30.0) * 100);
  };

  /**
   * Generate the totp code.
   */
  const generateTotpCode = (secretKey: string): string => {
    try {
      const totp = new OTPAuth.TOTP({
        secret: secretKey,
        algorithm: 'SHA1',
        digits: 6,
        period: 30
      });
      return totp.generate();
    } catch (error) {
      console.error('Error generating TOTP code:', error);
      return 'Error';
    }
  };

  /**
   * Copy the totp code to the clipboard.
   */
  const copyToClipboardWithClear = async (code: string): Promise<void> => {
    try {
      // Get clipboard clear timeout from settings
      const timeoutSeconds = await getClipboardClearTimeout();

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
    /**
     * Update the totp codes.
     */
    const updateTotpCodes = (prevCodes: Record<string, string>): Record<string, string> => {
      const newCodes: Record<string, string> = {};
      totpCodes.forEach(code => {
        const generatedCode = generateTotpCode(code.SecretKey);
        if (generatedCode !== 'Error') {
          newCodes[code.Id] = generatedCode;
        } else {
          newCodes[code.Id] = prevCodes[code.Id] ?? 'Error';
        }
      });
      return newCodes;
    };

    const initialCodes: Record<string, string> = {};
    totpCodes.forEach(code => {
      initialCodes[code.Id] = generateTotpCode(code.SecretKey);
    });
    setCurrentCodes(initialCodes);

    const intervalId = setInterval(() => {
      setCurrentCodes(updateTotpCodes);
    }, 1000);

    return () : void => clearInterval(intervalId);
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
                {t('items.totpCode')}
              </ThemedText>
              <ThemedText style={styles.code}>
                {currentCodes[totpCode.Id]}
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
