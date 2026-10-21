import { familySharingText } from '@aliasvault/client/sharing/FamilySharingView';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Share, StyleSheet, TouchableOpacity, View } from 'react-native';

import { copyToClipboard } from '@/utils/ClipboardUtility';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';

const COPIED_FEEDBACK_MS = 2000;

interface IFamilyCodeProps {
  /** The account's own code. */
  code: string;
  /** A smaller pill without the copy and share buttons, for showing the code inside other content. */
  isSmall?: boolean;
}

/**
 * The account's own code, with buttons to copy and share it; tapping the code itself copies it too. The code is not secret, so it is never cleared from the clipboard.
 */
export const FamilyCode: React.FC<IFamilyCodeProps> = ({ code, isSmall = false }) => {
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
   * Copy the code to the clipboard.
   */
  const copy = async (): Promise<void> => {
    try {
      await copyToClipboard(code);
      setCopied(true);
    } catch (error) {
      console.error('Failed to copy the code:', error);
    }
  };

  /**
   * Open the share sheet with the code.
   */
  const share = async (): Promise<void> => {
    try {
      await Share.share({ message: code });
    } catch (error) {
      console.error('Failed to share the code:', error);
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

  return (
    <View>
      <TouchableOpacity style={[styles.pill, isSmall && styles.smallPill]} onPress={() => void copy()} activeOpacity={0.7} accessibilityRole="button" accessibilityHint={t('common.copyToClipboard')}>
        <Ionicons name="shield-checkmark-outline" size={isSmall ? 15 : 18} color={colors.primary} />
        <ThemedText style={[styles.pillLabel, isSmall && styles.smallLabel]}>{familySharingText.yourCode}</ThemedText>
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

export default FamilyCode;
