import { sharingText } from '@aliasvault/client/sharing/SharingView';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Share, StyleSheet, TouchableOpacity, View } from 'react-native';

import { copyToClipboard } from '@/utils/ClipboardUtility';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';

const COPIED_FEEDBACK_MS = 2000;

/**
 * How the fingerprint is shown.
 */
export type AccountFingerprintVariant = 'pill' | 'small' | 'bar';

interface IAccountFingerprintProps {
  code: string;
  variant?: AccountFingerprintVariant;
}

/**
 * The account's own fingerprint, with buttons to copy and share it; tapping the fingerprint itself copies it too. The fingerprint is not secret, so it is never cleared from the clipboard.
 */
export const AccountFingerprint: React.FC<IAccountFingerprintProps> = ({ code, variant = 'pill' }) => {
  const isSmall = variant === 'small';
  const { t } = useTranslation();
  const colors = useColors();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return undefined;
    }
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return (): void => clearTimeout(timer);
  }, [copied]);

  /**
   * Copy the fingerprint to the clipboard.
   */
  const copy = async (): Promise<void> => {
    try {
      await copyToClipboard(code);
      setCopied(true);
    } catch (error) {
      console.error('Failed to copy the fingerprint:', error);
    }
  };

  /**
   * Open the share sheet with the fingerprint.
   */
  const share = async (): Promise<void> => {
    try {
      await Share.share({ message: code });
    } catch (error) {
      console.error('Failed to share the fingerprint:', error);
    }
  };

  const styles = StyleSheet.create({
    actionButton: {
      alignItems: 'center',
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    actionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 8,
    },
    actionText: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '500',
    },
    bar: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderColor: colors.primary,
      borderRadius: 10,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 10,
      paddingLeft: 14,
      paddingRight: 4,
      paddingVertical: 4,
    },
    barButton: {
      padding: 8,
    },
    barCode: {
      flex: 1,
    },
    pill: {
      alignItems: 'center',
      alignSelf: 'flex-start',
      backgroundColor: colors.accentBackground,
      borderColor: colors.primary,
      borderRadius: 999,
      borderWidth: 1,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    pillCode: {
      color: colors.text,
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
      fontSize: 16,
      fontWeight: '700',
      letterSpacing: 1,
    },
    pillLabel: {
      color: colors.textMuted,
      fontSize: 13,
    },
    smallCode: {
      fontSize: 14,
    },
    smallLabel: {
      fontSize: 12,
    },
    smallPill: {
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
  });

  if (variant === 'bar') {
    return (
      <View style={styles.bar}>
        <Ionicons name="shield-checkmark-outline" size={18} color={colors.primary} />
        <TouchableOpacity style={styles.barCode} onPress={() => void copy()} activeOpacity={0.7} accessibilityRole="button" accessibilityHint={t('common.copyToClipboard')}>
          <ThemedText style={styles.pillCode} numberOfLines={1} adjustsFontSizeToFit>{code}</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity style={styles.barButton} onPress={() => void copy()} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={t('common.copyToClipboard')}>
          <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={20} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.barButton} onPress={() => void share()} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={t('common.share')}>
          <Ionicons name="share-outline" size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View>
      <TouchableOpacity style={[styles.pill, isSmall && styles.smallPill]} onPress={() => void copy()} activeOpacity={0.7} accessibilityRole="button" accessibilityHint={t('common.copyToClipboard')}>
        <Ionicons name="shield-checkmark-outline" size={isSmall ? 15 : 18} color={colors.primary} />
        <ThemedText style={[styles.pillLabel, isSmall && styles.smallLabel]}>{sharingText.yourFingerprint}</ThemedText>
        <ThemedText style={[styles.pillCode, isSmall && styles.smallCode]}>{code}</ThemedText>
        {isSmall && <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={14} color={colors.primary} />}
      </TouchableOpacity>
      {!isSmall && (
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionButton} onPress={() => void copy()} activeOpacity={0.7} accessibilityRole="button">
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={colors.primary} />
            <ThemedText style={styles.actionText}>{copied ? t('common.copiedShort') : t('common.copyToClipboard')}</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={() => void share()} activeOpacity={0.7} accessibilityRole="button">
            <Ionicons name="share-outline" size={16} color={colors.primary} />
            <ThemedText style={styles.actionText}>{t('common.share')}</ThemedText>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

export default AccountFingerprint;
