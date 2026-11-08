import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors } from '@/hooks/useColorScheme';

/** Extra list padding at the bottom so the floating bar never covers the last rows. */
export const SELECTION_BAR_SPACE = 64;

type SelectionBarProps = {
  count: number;
  visibleCount: number;
  onSelectAll: () => void;
  onClose: () => void;
  children: React.ReactNode;
};

/**
 * Floating bar of a list in selection mode: close, count, select all and the given actions.
 */
export function SelectionBar({ count, visibleCount, onSelectAll, onClose, children }: SelectionBarProps): React.ReactNode {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const allSelected = count > 0 && count >= visibleCount;

  // The Android back button leaves selection mode first.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return (): void => subscription.remove();
  }, [onClose]);

  const styles = StyleSheet.create({
    bar: {
      alignItems: 'center',
      backgroundColor: colors.modalSurfaceRaised,
      borderColor: colors.accentBorder,
      borderRadius: 14,
      borderWidth: 1,
      bottom: Platform.OS === 'ios' ? insets.bottom + 12 : 12,
      elevation: 8,
      flexDirection: 'row',
      gap: 4,
      left: 12,
      padding: 6,
      position: 'absolute',
      right: 12,
      shadowColor: colors.black,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.2,
      shadowRadius: 12,
    },
    count: {
      color: colors.text,
      fontSize: 15,
      fontVariant: ['tabular-nums'],
      fontWeight: '600',
      paddingLeft: 4,
      paddingRight: 2,
    },
    divider: {
      backgroundColor: colors.accentBorder,
      height: 20,
      marginHorizontal: 4,
      width: 1,
    },
    iconButton: {
      alignItems: 'center',
      borderRadius: 10,
      height: 40,
      justifyContent: 'center',
      width: 40,
    },
    selectAll: {
      flexShrink: 1,
      paddingHorizontal: 8,
      paddingVertical: 10,
    },
    selectAllText: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '500',
    },
    spacer: {
      flex: 1,
    },
  });

  return (
    <View style={styles.bar} accessibilityRole="toolbar" testID="selection-action-bar">
      <TouchableOpacity style={styles.iconButton} onPress={onClose} accessibilityLabel={t('common.close')} testID="selection-close">
        <MaterialIcons name="close" size={22} color={colors.textMuted} />
      </TouchableOpacity>
      <Text style={styles.count} accessibilityLiveRegion="polite">{t('common.selection.count', { count })}</Text>
      <View style={styles.divider} />
      <TouchableOpacity style={[styles.selectAll, allSelected && { opacity: 0.4 }]} onPress={onSelectAll} disabled={allSelected} testID="selection-select-all">
        <Text style={styles.selectAllText} numberOfLines={1}>{t('common.selection.selectAll')}</Text>
      </TouchableOpacity>
      <View style={styles.spacer} />
      {children}
    </View>
  );
}

type SelectionBarButtonProps = {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  testID?: string;
};

/**
 * An icon-only action button in the selection bar.
 */
export function SelectionBarButton({ icon, label, onPress, disabled = false, danger = false, testID }: SelectionBarButtonProps): React.ReactNode {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={{ alignItems: 'center', borderRadius: 10, height: 40, justifyContent: 'center', opacity: disabled ? 0.4 : 1, width: 40 }}
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      testID={testID}
    >
      <MaterialIcons name={icon} size={22} color={danger ? colors.destructive : colors.text} />
    </TouchableOpacity>
  );
}
