import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ItemFilter, type ItemFilterType } from '@aliasvault/client/items/ItemFilters';

import { useColors } from '@/hooks/useColorScheme';

import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';

/**
 * Active selection — `'deleted'` means the Recently Deleted page is current
 * and no item filter is highlighted.
 */
export type ItemFilterSelection = ItemFilterType | 'deleted';

type ItemTypeOption = {
  type: ItemFilterType;
  titleKey: string;
  iconName: keyof typeof MaterialIcons.glyphMap;
};

const ITEM_TYPE_OPTIONS: ItemTypeOption[] = [
  { type: ItemFilter.Login, titleKey: 'itemTypes.login.title', iconName: 'key' },
  { type: ItemFilter.Alias, titleKey: 'itemTypes.alias.title', iconName: 'person' },
  { type: ItemFilter.CreditCard, titleKey: 'itemTypes.creditCard.title', iconName: 'credit-card' },
  { type: ItemFilter.Note, titleKey: 'itemTypes.note.title', iconName: 'description' },
];

interface ItemFilterMenuProps {
  visible: boolean;
  activeFilter: ItemFilterSelection;
  recentlyDeletedCount: number;
  showFoldersToggle?: boolean;
  showFolders?: boolean;
  /** Optional override for the overlay's top offset (used to position below custom headers). */
  topOffset?: number;
  onSelectFilter: (filter: ItemFilterType) => void;
  onSelectRecentlyDeleted: () => void;
  onToggleShowFolders?: (next: boolean) => void;
  onClose: () => void;
}

/**
 * Filter menu overlay used by the items list and Recently Deleted screens. The
 * caller renders its own trigger (e.g. in the screen header) and controls the
 * `visible` flag.
 */
export function ItemFilterMenu({
  visible,
  activeFilter,
  recentlyDeletedCount,
  showFoldersToggle = false,
  showFolders = false,
  topOffset,
  onSelectFilter,
  onSelectRecentlyDeleted,
  onToggleShowFolders,
  onClose,
}: ItemFilterMenuProps): React.ReactNode {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  if (!visible) {
    return null;
  }

  const defaultTopOffset = Platform.OS === 'ios' ? insets.top + 112 : 8;
  const resolvedTopOffset = topOffset ?? defaultTopOffset;

  const styles = StyleSheet.create({
    overlay: {
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      elevation: 8,
      left: 14,
      overflow: 'hidden',
      position: 'absolute',
      right: 14,
      shadowColor: colors.black,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
      top: resolvedTopOffset,
      zIndex: 1001,
    },
    backdrop: {
      bottom: 0,
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
      zIndex: 1000,
    },
    item: {
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    itemWithIcon: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
    },
    icon: {
      width: 18,
    },
    itemActive: {
      backgroundColor: colors.primary + '20',
    },
    itemText: {
      color: colors.text,
      fontSize: 14,
    },
    itemTextActive: {
      color: colors.primary,
      fontWeight: '600',
    },
    separator: {
      backgroundColor: colors.accentBorder,
      height: 1,
      marginVertical: 4,
    },
    itemWithBadge: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      width: '100%',
    },
    itemWithToggle: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    itemLabel: {
      flex: 1,
    },
    toggle: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 6,
      padding: 4,
    },
    toggleHint: {
      color: colors.textMuted,
      fontSize: 12,
    },
    badge: {
      color: colors.textMuted,
      fontSize: 14,
    },
    badgeActive: {
      color: colors.primary,
      fontSize: 14,
    },
  });

  const handlePickFilter = (filter: ItemFilterType): void => {
    onClose();
    onSelectFilter(filter);
  };

  const handleRecentlyDeleted = (): void => {
    onClose();
    onSelectRecentlyDeleted();
  };

  const isActive = (filter: ItemFilterType): boolean => activeFilter === filter;
  const isRecentlyDeletedActive = activeFilter === 'deleted';

  return (
    <>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <ThemedView style={styles.overlay}>
        {/* All items + show folders toggle */}
        <View style={[styles.item, styles.itemWithToggle, isActive(ItemFilter.All) && styles.itemActive]}>
          <TouchableOpacity style={styles.itemLabel} onPress={() => handlePickFilter(ItemFilter.All)}>
            <ThemedText style={[styles.itemText, isActive(ItemFilter.All) && styles.itemTextActive]}>
              {t('items.title')}
            </ThemedText>
          </TouchableOpacity>
          {showFoldersToggle && onToggleShowFolders && (
            <TouchableOpacity
              style={styles.toggle}
              onPress={() => {
                onToggleShowFolders(!showFolders);
                onClose();
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <ThemedText style={styles.toggleHint}>{t('items.filters.showFolders')}</ThemedText>
              <MaterialIcons
                name={showFolders ? 'check-box' : 'check-box-outline-blank'}
                size={20}
                color={showFolders ? colors.primary : colors.textMuted}
              />
            </TouchableOpacity>
          )}
        </View>

        <ThemedView style={styles.separator} />

        {/* Item type filters */}
        {ITEM_TYPE_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.type}
            style={[styles.item, styles.itemWithIcon, isActive(option.type) && styles.itemActive]}
            onPress={() => handlePickFilter(option.type)}
          >
            <MaterialIcons
              name={option.iconName}
              size={18}
              color={isActive(option.type) ? colors.primary : colors.textMuted}
              style={styles.icon}
            />
            <ThemedText style={[styles.itemText, isActive(option.type) && styles.itemTextActive]}>
              {t(option.titleKey)}
            </ThemedText>
          </TouchableOpacity>
        ))}

        <ThemedView style={styles.separator} />

        {/* Passkeys / Attachments / TOTP */}
        <TouchableOpacity
          style={[styles.item, isActive(ItemFilter.Passkeys) && styles.itemActive]}
          onPress={() => handlePickFilter(ItemFilter.Passkeys)}
        >
          <ThemedText style={[styles.itemText, isActive(ItemFilter.Passkeys) && styles.itemTextActive]}>
            {t('common.passkeys')}
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.item, isActive(ItemFilter.Attachments) && styles.itemActive]}
          onPress={() => handlePickFilter(ItemFilter.Attachments)}
        >
          <ThemedText style={[styles.itemText, isActive(ItemFilter.Attachments) && styles.itemTextActive]}>
            {t('common.attachments')}
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.item, isActive(ItemFilter.Totp) && styles.itemActive]}
          onPress={() => handlePickFilter(ItemFilter.Totp)}
        >
          <ThemedText style={[styles.itemText, isActive(ItemFilter.Totp) && styles.itemTextActive]}>
            {t('items.filters.totp')}
          </ThemedText>
        </TouchableOpacity>

        <ThemedView style={styles.separator} />

        {/* Recently deleted */}
        <TouchableOpacity
          style={[styles.item, isRecentlyDeletedActive && styles.itemActive]}
          onPress={handleRecentlyDeleted}
        >
          <View style={styles.itemWithBadge}>
            <ThemedText style={[styles.itemText, isRecentlyDeletedActive && styles.itemTextActive]}>
              {t('items.recentlyDeleted.title')}
            </ThemedText>
            {recentlyDeletedCount > 0 && (
              <ThemedText style={isRecentlyDeletedActive ? styles.badgeActive : styles.badge}>
                {recentlyDeletedCount}
              </ThemedText>
            )}
          </View>
        </TouchableOpacity>
      </ThemedView>
    </>
  );
}
