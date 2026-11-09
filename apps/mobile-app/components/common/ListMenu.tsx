import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TouchableOpacity, View, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CredentialSortOrder } from '@aliasvault/client/database/repositories/SettingsRepository';

import { useColors } from '@/hooks/useColorScheme';
import { SORT_OPTIONS } from '@/hooks/useItemSort';

import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';

/**
 * An extra entry at the bottom of a list menu, below a separator.
 */
export interface ListMenuAction {
  label: string;
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  onPress: () => void;
  destructive?: boolean;
}

interface ListMenuProps {
  visible: boolean;
  sortOrder?: CredentialSortOrder;
  onSelect?: (order: CredentialSortOrder) => void;
  onClose: () => void;
  topOffset?: number;
  selection?: { isActive: boolean; onToggle: () => void };
  actions?: ListMenuAction[];
}

/**
 * The ellipsis menu of a list: selection mode and, for items, the sort options.
 */
export function ListMenu({
  visible,
  sortOrder,
  onSelect,
  onClose,
  topOffset,
  selection,
  actions,
}: ListMenuProps): React.ReactNode {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  if (!visible) {
    return null;
  }

  // Calculate default top offset based on platform
  const defaultTopOffset = Platform.OS === 'ios' ? insets.top + 112 : 8;
  const menuTop = topOffset ?? defaultTopOffset;

  const styles = StyleSheet.create({
    backdrop: {
      bottom: 0,
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
      zIndex: 1000,
    },
    menuOverlay: {
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      elevation: 8,
      overflow: 'hidden',
      position: 'absolute',
      right: 14,
      shadowColor: colors.black,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
      top: menuTop,
      maxWidth: 280,
      minWidth: 200,
      zIndex: 1001,
    },
    menuItem: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    menuItemIcon: {
      width: 18,
    },
    menuItemText: {
      color: colors.text,
      fontSize: 14,
    },
    separator: {
      backgroundColor: colors.accentBorder,
      height: 1,
    },
    menuItemTextActive: {
      color: colors.primary,
      fontWeight: '600',
    },
  });

  return (
    <>
      {/* Backdrop to close menu when tapping outside */}
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      />
      {/* Menu content */}
      <ThemedView style={styles.menuOverlay}>
        {selection && (
          <>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                onClose();
                selection.onToggle();
              }}
              testID="list-select"
            >
              <MaterialIcons name={selection.isActive ? 'check-box-outline-blank' : 'check-box'} size={18} color={colors.text} style={styles.menuItemIcon} />
              <ThemedText style={styles.menuItemText}>
                {selection.isActive ? t('common.selection.disable') : t('common.selection.enable')}
              </ThemedText>
            </TouchableOpacity>
            {onSelect && <View style={styles.separator} />}
          </>
        )}
        {onSelect && SORT_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.value}
            style={styles.menuItem}
            onPress={() => {
              onSelect(option.value);
              onClose();
            }}
          >
            {sortOrder === option.value ? (
              <MaterialIcons
                name="check"
                size={18}
                color={colors.primary}
                style={styles.menuItemIcon}
              />
            ) : (
              <View style={styles.menuItemIcon} />
            )}
            <ThemedText style={[
              styles.menuItemText,
              sortOrder === option.value && styles.menuItemTextActive
            ]}>
              {t(option.labelKey)}
            </ThemedText>
          </TouchableOpacity>
        ))}
        {actions && actions.length > 0 && (selection || onSelect) && <View style={styles.separator} />}
        {actions?.map((action) => (
          <TouchableOpacity
            key={action.label}
            style={styles.menuItem}
            onPress={() => {
              onClose();
              action.onPress();
            }}
          >
            <MaterialIcons name={action.icon} size={18} color={action.destructive ? colors.destructive : colors.text} style={styles.menuItemIcon} />
            <ThemedText style={[styles.menuItemText, action.destructive && { color: colors.destructive }]}>
              {action.label}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </ThemedView>
    </>
  );
}

interface SortButtonProps {
  /**
   * Callback when button is pressed.
   */
  onPress: () => void;
  /**
   * Optional style variant for different contexts.
   */
  variant?: 'header' | 'inline';
}

/**
 * Reusable sort button component.
 * Can be used in headers or inline with other controls.
 */
export function SortButton({ onPress, variant = 'inline' }: SortButtonProps): React.ReactNode {
  const colors = useColors();

  const styles = StyleSheet.create({
    button: {
      padding: 8,
      marginRight: variant === 'header' ? 8 : 0,
    },
  });

  return (
    <TouchableOpacity
      style={styles.button}
      onPress={onPress}
    >
      <MaterialIcons
        name="sort"
        size={24}
        color={variant === 'header' ? colors.text : colors.textMuted}
      />
    </TouchableOpacity>
  );
}
