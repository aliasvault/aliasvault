import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, Platform, Animated, TextInput, TouchableOpacity, View, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import type { Folder } from '@/utils/db/repositories/FolderRepository';
import type { CredentialSortOrder } from '@/utils/db/repositories/SettingsRepository';
import type { Item, ItemType } from '@/utils/dist/core/models/vault';
import { getFieldValue, FieldKey, ItemTypes } from '@/utils/dist/core/models/vault';
import emitter from '@/utils/EventEmitter';
import { VaultAuthenticationError } from '@/utils/types/errors/VaultAuthenticationError';

import { useColors } from '@/hooks/useColorScheme';
import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';
import { useVaultMutate } from '@/hooks/useVaultMutate';
import { useVaultSync } from '@/hooks/useVaultSync';

import Logo from '@/assets/images/logo.svg';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { FolderModal } from '@/components/folders/FolderModal';
import { FolderPill, type FolderWithCount } from '@/components/folders/FolderPill';
import { ItemCard } from '@/components/items/ItemCard';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { AndroidHeader } from '@/components/ui/AndroidHeader';
import { CollapsibleHeader } from '@/components/ui/CollapsibleHeader';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { SkeletonLoader } from '@/components/ui/SkeletonLoader';
import { useApp } from '@/context/AppContext';
import { useDb } from '@/context/DbContext';

/**
 * Filter types for the items list.
 */
type FilterType = 'all' | 'passkeys' | 'attachments' | ItemType;

/**
 * Check if a filter is an item type filter.
 */
const isItemTypeFilter = (filter: FilterType): filter is ItemType => {
  return Object.values(ItemTypes).includes(filter as ItemType);
};

/**
 * Item type filter option configuration.
 */
type ItemTypeOption = {
  type: ItemType;
  titleKey: string;
  iconName: keyof typeof MaterialIcons.glyphMap;
};

/**
 * Available item type filter options with icons.
 */
const ITEM_TYPE_OPTIONS: ItemTypeOption[] = [
  { type: ItemTypes.Login, titleKey: 'itemTypes.login.title', iconName: 'key' },
  { type: ItemTypes.Alias, titleKey: 'itemTypes.alias.title', iconName: 'person' },
  { type: ItemTypes.CreditCard, titleKey: 'itemTypes.creditCard.title', iconName: 'credit-card' },
  { type: ItemTypes.Note, titleKey: 'itemTypes.note.title', iconName: 'description' },
];

/**
 * Sort order options with their translation keys.
 */
const SORT_OPTIONS: { value: CredentialSortOrder; labelKey: string }[] = [
  { value: 'OldestFirst', labelKey: 'items.sort.oldestFirst' },
  { value: 'NewestFirst', labelKey: 'items.sort.newestFirst' },
  { value: 'Alphabetical', labelKey: 'items.sort.alphabetical' },
];

/**
 * Items screen - main vault items list.
 */
export default function ItemsScreen(): React.ReactNode {
  const { syncVault } = useVaultSync();
  const { t } = useTranslation();
  const colors = useColors();
  const scrollY = useRef(new Animated.Value(0)).current;
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<Animated.FlatList<Item | null>>(null);
  const [isTabFocused, setIsTabFocused] = useState(false);
  const router = useRouter();
  const { itemUrl } = useLocalSearchParams<{ itemUrl?: string }>();
  const [itemsList, setItemsList] = useState<Item[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useMinDurationLoading(false, 200);
  const [refreshing, setRefreshing] = useMinDurationLoading(false, 200);
  const { executeVaultMutation } = useVaultMutate();
  const [showFolderModal, setShowFolderModal] = useState(false);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [sortOrder, setSortOrder] = useState<CredentialSortOrder>('OldestFirst');
  const [showSortMenu, setShowSortMenu] = useState(false);

  // Recently deleted count state
  const [recentlyDeletedCount, setRecentlyDeletedCount] = useState(0);

  // Alert dialog state
  const [alertConfig, setAlertConfig] = useState<{ title: string; message: string } | null>(null);

  /**
   * Hide the alert dialog.
   */
  const hideAlert = useCallback((): void => {
    setAlertConfig(null);
  }, []);

  const authContext = useApp();
  const dbContext = useDb();

  const isAuthenticated = authContext.isLoggedIn;
  const isDatabaseAvailable = dbContext.dbAvailable;

  // Handle deep link itemUrl parameter - populate search field
  useEffect(() => {
    if (itemUrl) {
      const decodedUrl = decodeURIComponent(itemUrl);
      setSearchQuery(decodedUrl);
    }
  }, [itemUrl]);

  /**
   * Get folders with item counts for display.
   */
  const foldersWithCounts = useMemo((): FolderWithCount[] => {
    // Don't show folders when searching
    if (searchQuery) {
      return [];
    }

    const folderCounts = new Map<string, number>();

    // Count items per folder
    itemsList.forEach((item: Item) => {
      if (item.FolderId) {
        folderCounts.set(item.FolderId, (folderCounts.get(item.FolderId) || 0) + 1);
      }
    });

    // Return folders with counts, sorted alphabetically
    return folders.map(folder => ({
      id: folder.Id,
      name: folder.Name,
      itemCount: folderCounts.get(folder.Id) || 0
    })).sort((a, b) => a.name.localeCompare(b.name));
  }, [folders, itemsList, searchQuery]);

  /**
   * Get the title based on the active filter.
   */
  const getFilterTitle = useCallback((): string => {
    switch (filterType) {
      case 'passkeys':
        return t('items.filters.passkeys');
      case 'attachments':
        return t('common.attachments');
      case 'all':
        return t('items.title');
      default:
        if (isItemTypeFilter(filterType)) {
          const itemTypeOption = ITEM_TYPE_OPTIONS.find(opt => opt.type === filterType);
          if (itemTypeOption) {
            return t(itemTypeOption.titleKey);
          }
        }
        return t('items.title');
    }
  }, [filterType, t]);

  /**
   * Check if all items are in folders (no items at root level but items exist in folders).
   * This is used to show a helpful message when the user has imported credentials that were all in folders.
   */
  const hasItemsInFoldersOnly = useMemo(() => {
    return itemsList.length > 0 && itemsList.every((item: Item) => item.FolderId !== null);
  }, [itemsList]);

  /**
   * Filter items by folder, type, and search query.
   */
  const filteredItems = useMemo(() => {
    return itemsList.filter(item => {
      // Root view (no search): exclude items in folders
      if (!searchQuery && item.FolderId) {
        return false;
      }
      // When searching: show all matching items regardless of folder

      // Apply type filter
      let passesTypeFilter = true;

      if (filterType === 'passkeys') {
        passesTypeFilter = item.HasPasskey === true;
      } else if (filterType === 'attachments') {
        passesTypeFilter = item.HasAttachment === true;
      } else if (isItemTypeFilter(filterType)) {
        passesTypeFilter = item.ItemType === filterType;
      }

      if (!passesTypeFilter) {
        return false;
      }

      // Apply search filter
      const searchLower = searchQuery.toLowerCase().trim();

      if (!searchLower) {
        return true;
      }

      const searchableFields = [
        item.Name?.toLowerCase() || '',
        getFieldValue(item, FieldKey.LoginUsername)?.toLowerCase() || '',
        getFieldValue(item, FieldKey.LoginEmail)?.toLowerCase() || '',
        getFieldValue(item, FieldKey.LoginUrl)?.toLowerCase() || '',
        getFieldValue(item, FieldKey.NotesContent)?.toLowerCase() || '',
      ];

      const searchWords = searchLower.split(/\s+/).filter(word => word.length > 0);

      return searchWords.every(word =>
        searchableFields.some(field => field.includes(word))
      );
    });
  }, [itemsList, searchQuery, filterType]);

  /**
   * Sort the filtered items based on the current sort order.
   */
  const sortedItems = useMemo(() => {
    const itemsCopy = [...filteredItems];
    switch (sortOrder) {
      case 'NewestFirst':
        return itemsCopy.sort((a, b) =>
          new Date(b.CreatedAt || 0).getTime() - new Date(a.CreatedAt || 0).getTime()
        );
      case 'Alphabetical':
        return itemsCopy.sort((a, b) =>
          (a.Name || '').localeCompare(b.Name || '')
        );
      case 'OldestFirst':
      default:
        return itemsCopy.sort((a, b) =>
          new Date(a.CreatedAt || 0).getTime() - new Date(b.CreatedAt || 0).getTime()
        );
    }
  }, [filteredItems, sortOrder]);

  /**
   * Load items (credentials), folders, and recently deleted count.
   */
  const loadItems = useCallback(async (): Promise<void> => {
    try {
      const [items, loadedFolders, deletedCount, savedSortOrder] = await Promise.all([
        dbContext.sqliteClient!.items.getAll(),
        dbContext.sqliteClient!.folders.getAll(),
        dbContext.sqliteClient!.items.getRecentlyDeletedCount(),
        dbContext.sqliteClient!.settings.getCredentialsSortOrder()
      ]);
      setItemsList(items);
      setFolders(loadedFolders);
      setRecentlyDeletedCount(deletedCount);
      setSortOrder(savedSortOrder);
      setIsLoadingItems(false);
    } catch (err) {
      console.error('Error loading items:', err);
      Toast.show({
        type: 'error',
        text1: t('items.errorLoadingItems'),
        text2: t('common.errors.unknownError'),
      });
      setIsLoadingItems(false);
    }
  }, [dbContext.sqliteClient, setIsLoadingItems, t]);

  useEffect(() => {
    const unsubscribeFocus = navigation.addListener('focus', () => {
      setIsTabFocused(true);
    });

    const unsubscribeBlur = navigation.addListener('blur', () => {
      setIsTabFocused(false);
    });

    const tabPressSub = emitter.addListener('tabPress', (routeName: string) => {
      if (routeName === 'items' && isTabFocused) {
        // Reset search and scroll to top when tapping the tab again
        setSearchQuery('');
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      }
    });

    // Add listener for item/credential changes
    const itemChangedSub = emitter.addListener('credentialChanged', async () => {
      await loadItems();
    });

    return (): void => {
      tabPressSub.remove();
      itemChangedSub.remove();
      unsubscribeFocus();
      unsubscribeBlur();
    };
  }, [isTabFocused, loadItems, navigation, setRefreshing]);

  /**
   * Handle pull-to-refresh.
   */
  const onRefresh = useCallback(async () => {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    setRefreshing(true);
    setIsLoadingItems(true);

    // Always attempt sync, even when offline - this allows recovery when connection is restored
    try {
      await syncVault({
        /**
         * On success.
         */
        onSuccess: async (hasNewVault) => {
          await loadItems();
          await dbContext.refreshSyncState(); // Clear offline state if we were offline
          setIsLoadingItems(false);
          setRefreshing(false);
          setTimeout(() => {
            Toast.show({
              type: 'success',
              text1: hasNewVault ? t('items.vaultSyncedSuccessfully') : t('items.vaultUpToDate'),
              position: 'top',
              visibilityTime: 1200,
            });
          }, 200);
        },
        /**
         * On offline - just update state, ServerSyncIndicator shows offline status.
         */
        onOffline: async () => {
          setRefreshing(false);
          setIsLoadingItems(false);
          await dbContext.setIsOffline(true);
          await dbContext.refreshSyncState();
        },
        /**
         * On error.
         */
        onError: async (error) => {
          console.error('Error syncing vault:', error);
          setRefreshing(false);
          setIsLoadingItems(false);

          // Show generic error message to user, detailed error is logged above
          setAlertConfig({ title: t('common.error'), message: t('common.errors.unknownError') });
        },
        /**
         * On upgrade required.
         */
        onUpgradeRequired: (): void => {
          router.replace('/upgrade');
        },
      });
    } catch (err) {
      console.error('Error refreshing items:', err);
      setRefreshing(false);
      setIsLoadingItems(false);

      if (!(err instanceof VaultAuthenticationError)) {
        Toast.show({
          type: 'error',
          text1: t('items.vaultSyncFailed'),
          text2: t('common.errors.unknownError'),
        });
      }
    }
  }, [syncVault, loadItems, setIsLoadingItems, setRefreshing, dbContext, router, t]);

  useEffect(() => {
    if (!isAuthenticated || !isDatabaseAvailable) {
      return;
    }

    setIsLoadingItems(true);
    loadItems();
  }, [isAuthenticated, isDatabaseAvailable, loadItems, setIsLoadingItems]);

  /**
   * Track previous syncing state to detect when sync completes.
   */
  const wasSyncingRef = useRef(dbContext.isSyncing);

  /**
   * Reload items when background sync completes (isSyncing goes from true to false).
   * This ensures newly synced data is displayed without requiring manual pull-to-refresh.
   */
  useEffect(() => {
    const wasSyncing = wasSyncingRef.current;
    wasSyncingRef.current = dbContext.isSyncing;

    // Only reload when sync just completed (was syncing, now not syncing)
    if (wasSyncing && !dbContext.isSyncing && isAuthenticated && isDatabaseAvailable) {
      loadItems();
    }
  }, [dbContext.isSyncing, isAuthenticated, isDatabaseAvailable, loadItems]);

  // Set header for Android
  useEffect(() => {
    navigation.setOptions({
      /**
       * Define custom header which is shown on Android. iOS displays the custom CollapsibleHeader component instead.
       */
      headerTitle: (): React.ReactNode => {
        if (Platform.OS === 'android') {
          // When all items are in folders, show simple title without dropdown
          if (hasItemsInFoldersOnly) {
            return (
              <AndroidHeader
                title={t('items.title')}
                subtitle=""
                onTitlePress={undefined}
                isDropdownOpen={false}
              />
            );
          }
          return (
            <AndroidHeader
              title={getFilterTitle()}
              subtitle={`(${filteredItems.length})`}
              onTitlePress={() => setShowFilterMenu(prev => !prev)}
              isDropdownOpen={showFilterMenu}
            />
          );
        }
        return <Text>{t('items.title')}</Text>;
      },
      /**
       * Sort button in the header (Android only, iOS uses inline button).
       */
      headerRight: (): React.ReactNode => {
        if (Platform.OS === 'android') {
          return (
            <TouchableOpacity
              style={{ padding: 8, marginRight: 8 }}
              onPress={() => setShowSortMenu(prev => !prev)}
            >
              <MaterialIcons name="sort" size={24} color={colors.text} />
            </TouchableOpacity>
          );
        }
        return null;
      },
    });
  }, [navigation, t, getFilterTitle, filteredItems.length, showFilterMenu, hasItemsInFoldersOnly, colors.text]);

  /**
   * Delete an item (move to trash).
   * Non-blocking: saves locally and syncs in background via ServerSyncIndicator.
   */
  const onItemDelete = useCallback(async (itemId: string): Promise<void> => {
    await executeVaultMutation(async () => {
      await dbContext.sqliteClient!.items.trash(itemId);
    });

    // Reload items to reflect the deletion
    await loadItems();
  }, [dbContext.sqliteClient, executeVaultMutation, loadItems]);

  /**
   * Navigate to a folder.
   */
  const handleFolderClick = useCallback((folderId: string) => {
    router.push(`/(tabs)/items/folder/${folderId}`);
  }, [router]);

  /**
   * Create a new folder.
   */
  const handleCreateFolder = useCallback(async (folderName: string) => {
    await executeVaultMutation(async () => {
      await dbContext.sqliteClient!.folders.create(folderName, null);
    });
    await loadItems();
  }, [dbContext.sqliteClient, executeVaultMutation, loadItems]);

  /**
   * Handle FAB press - navigate to add item screen.
   * If there's a search query, pass it as itemUrl (if URL) or itemName (if not).
   */
  const handleAddItem = useCallback(() => {
    const trimmedQuery = searchQuery.trim();
    if (trimmedQuery) {
      const isUrl = /^https?:\/\//i.test(trimmedQuery);
      if (isUrl) {
        router.push(`/(tabs)/items/add-edit?itemUrl=${encodeURIComponent(trimmedQuery)}`);
      } else {
        router.push(`/(tabs)/items/add-edit?itemName=${encodeURIComponent(trimmedQuery)}`);
      }
    } else {
      router.push('/(tabs)/items/add-edit');
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [router, searchQuery]);

  const styles = StyleSheet.create({
    container: {
      paddingHorizontal: 0,
    },
    stepContainer: {
      flex: 1,
      gap: 8,
    },
    contentContainer: {
      paddingBottom: Platform.OS === 'ios' ? insets.bottom + 60 : 10,
      paddingHorizontal: 14,
      paddingTop: Platform.OS === 'ios' ? 42 : 8,
    },
    // Header row styles
    headerRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    // Filter button styles
    filterButton: {
      alignItems: 'center',
      flexDirection: 'row',
      flex: 1,
      gap: 8,
    },
    sortButton: {
      padding: 8,
    },
    filterButtonText: {
      color: colors.text,
      fontSize: 28,
      fontWeight: 'bold',
      lineHeight: 34,
    },
    filterCount: {
      color: colors.textMuted,
      fontSize: 20,
      lineHeight: 28,
    },
    // Filter menu styles
    filterMenuOverlay: {
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
      top: Platform.OS === 'ios' ? insets.top + 112 : 8,
      zIndex: 1001,
    },
    filterMenuBackdrop: {
      bottom: 0,
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
      zIndex: 1000,
    },
    // Sort menu styles
    sortMenuOverlay: {
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
      top: Platform.OS === 'ios' ? insets.top + 112 : 8,
      width: 200,
      zIndex: 1001,
    },
    sortMenuBackdrop: {
      bottom: 0,
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
      zIndex: 1000,
    },
    filterMenuItem: {
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    filterMenuItemWithIcon: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
    },
    filterMenuItemIcon: {
      width: 18,
    },
    filterMenuItemActive: {
      backgroundColor: colors.primary + '20',
    },
    filterMenuItemText: {
      color: colors.text,
      fontSize: 14,
    },
    filterMenuItemTextActive: {
      color: colors.primary,
      fontWeight: '600',
    },
    filterMenuSeparator: {
      backgroundColor: colors.accentBorder,
      height: 1,
      marginVertical: 4,
    },
    filterMenuItemWithBadge: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      width: '100%',
    },
    filterMenuItemBadge: {
      color: colors.textMuted,
      fontSize: 14,
    },
    // Folder pills styles
    folderPillsContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 16,
    },
    newFolderButton: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 20,
      borderStyle: 'dashed',
      borderWidth: 1,
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    newFolderButtonText: {
      color: colors.textMuted,
      fontSize: 14,
    },
    // Search styles
    searchContainer: {
      position: 'relative',
      marginTop: 12,
    },
    searchIcon: {
      left: 12,
      position: 'absolute',
      top: 11,
      zIndex: 1,
    },
    searchInput: {
      backgroundColor: colors.accentBackground,
      borderRadius: 8,
      color: colors.text,
      fontSize: 16,
      height: 40,
      lineHeight: 20,
      marginBottom: 16,
      paddingLeft: 40,
      paddingRight: Platform.OS === 'android' ? 40 : 12,
    },
    clearButton: {
      padding: 4,
      position: 'absolute',
      right: 8,
      top: 4,
    },
    clearButtonText: {
      color: colors.textMuted,
      fontSize: 20,
    },
    // Empty state styles
    emptyContainer: {
      alignItems: 'center',
      marginTop: 24,
    },
    emptyText: {
      color: colors.textMuted,
      fontSize: 16,
      opacity: 0.7,
      textAlign: 'center',
    },
    clearButtonsContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      justifyContent: 'center',
      marginTop: 16,
    },
    clearSearchButton: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderRadius: 8,
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    clearSearchButtonText: {
      color: colors.text,
      fontSize: 14,
    },
    clearFilterButton: {
      alignItems: 'center',
      backgroundColor: colors.primary + '20',
      borderRadius: 8,
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    clearFilterButtonText: {
      color: colors.primary,
      fontSize: 14,
    },
    // Footer clear buttons styles (at bottom of list)
    footerClearContainer: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      justifyContent: 'center',
      marginTop: 16,
      paddingTop: 16,
    },
    // FAB styles
    fab: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 28,
      bottom: Platform.OS === 'ios' ? insets.bottom + 60 : 16,
      elevation: 4,
      height: 56,
      justifyContent: 'center',
      position: 'absolute',
      right: 16,
      shadowColor: colors.black,
      shadowOffset: {
        width: 0,
        height: 2,
      },
      shadowOpacity: 0.25,
      shadowRadius: 3.84,
      width: 56,
      zIndex: 1000,
    },
    fabIcon: {
      color: colors.primarySurfaceText,
      fontSize: 24,
    },
  });

  /**
   * Render the filter menu as an absolute overlay.
   */
  const renderFilterOverlay = (): React.ReactNode => {
    if (!showFilterMenu || hasItemsInFoldersOnly) {
      return null;
    }

    return (
      <>
        {/* Backdrop to close menu when tapping outside */}
        <TouchableOpacity
          style={styles.filterMenuBackdrop}
          activeOpacity={1}
          onPress={() => setShowFilterMenu(false)}
        />
        {/* Menu content */}
        <ThemedView style={styles.filterMenuOverlay}>
          {/* All items filter */}
          <TouchableOpacity
            style={[
              styles.filterMenuItem,
              filterType === 'all' && styles.filterMenuItemActive
            ]}
            onPress={() => {
              setFilterType('all');
              setShowFilterMenu(false);
            }}
          >
            <ThemedText style={[
              styles.filterMenuItemText,
              filterType === 'all' && styles.filterMenuItemTextActive
            ]}>
              {t('items.filters.all')}
            </ThemedText>
          </TouchableOpacity>

          <ThemedView style={styles.filterMenuSeparator} />

          {/* Item type filters */}
          {ITEM_TYPE_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.type}
              style={[
                styles.filterMenuItem,
                styles.filterMenuItemWithIcon,
                filterType === option.type && styles.filterMenuItemActive
              ]}
              onPress={() => {
                setFilterType(option.type);
                setShowFilterMenu(false);
              }}
            >
              <MaterialIcons
                name={option.iconName}
                size={18}
                color={filterType === option.type ? colors.primary : colors.textMuted}
                style={styles.filterMenuItemIcon}
              />
              <ThemedText style={[
                styles.filterMenuItemText,
                filterType === option.type && styles.filterMenuItemTextActive
              ]}>
                {t(option.titleKey)}
              </ThemedText>
            </TouchableOpacity>
          ))}

          <ThemedView style={styles.filterMenuSeparator} />

          {/* Passkeys filter */}
          <TouchableOpacity
            style={[
              styles.filterMenuItem,
              filterType === 'passkeys' && styles.filterMenuItemActive
            ]}
            onPress={() => {
              setFilterType('passkeys');
              setShowFilterMenu(false);
            }}
          >
            <ThemedText style={[
              styles.filterMenuItemText,
              filterType === 'passkeys' && styles.filterMenuItemTextActive
            ]}>
              {t('items.filters.passkeys')}
            </ThemedText>
          </TouchableOpacity>

          {/* Attachments filter */}
          <TouchableOpacity
            style={[
              styles.filterMenuItem,
              filterType === 'attachments' && styles.filterMenuItemActive
            ]}
            onPress={() => {
              setFilterType('attachments');
              setShowFilterMenu(false);
            }}
          >
            <ThemedText style={[
              styles.filterMenuItemText,
              filterType === 'attachments' && styles.filterMenuItemTextActive
            ]}>
              {t('common.attachments')}
            </ThemedText>
          </TouchableOpacity>

          <ThemedView style={styles.filterMenuSeparator} />

          {/* Recently deleted */}
          <TouchableOpacity
            style={styles.filterMenuItem}
            onPress={() => {
              setShowFilterMenu(false);
              router.push('/(tabs)/items/deleted');
            }}
          >
            <View style={styles.filterMenuItemWithBadge}>
              <ThemedText style={styles.filterMenuItemText}>
                {t('items.recentlyDeleted.title')}
              </ThemedText>
              {recentlyDeletedCount > 0 && (
                <ThemedText style={styles.filterMenuItemBadge}>
                  {recentlyDeletedCount}
                </ThemedText>
              )}
            </View>
          </TouchableOpacity>
        </ThemedView>
      </>
    );
  };

  /**
   * Render the list header with filter button, folders, and search.
   */
  const renderListHeader = (): React.ReactNode => {
    return (
      <ThemedView>
        {/* Large header with logo (iOS only) */}
        {Platform.OS === 'ios' && (
          <View style={styles.headerRow}>
            {hasItemsInFoldersOnly ? (
              /* When all items are in folders, show simple title without dropdown */
              <View style={styles.filterButton}>
                <Logo width={40} height={40} />
                <ThemedText style={styles.filterButtonText}>
                  {t('items.title')}
                </ThemedText>
              </View>
            ) : (
              /* Normal filter dropdown when there are items at root */
              <TouchableOpacity
                style={styles.filterButton}
                onPress={() => setShowFilterMenu(!showFilterMenu)}
              >
                <Logo width={40} height={40} />
                <ThemedText style={styles.filterButtonText}>
                  {getFilterTitle()}
                </ThemedText>
                <ThemedText style={styles.filterCount}>
                  ({filteredItems.length})
                </ThemedText>
                <MaterialIcons
                  name={showFilterMenu ? "keyboard-arrow-up" : "keyboard-arrow-down"}
                  size={28}
                  color={colors.text}
                />
              </TouchableOpacity>
            )}
            {/* Sort button */}
            <TouchableOpacity
              style={styles.sortButton}
              onPress={() => setShowSortMenu(!showSortMenu)}
            >
              <MaterialIcons
                name="sort"
                size={24}
                color={colors.textMuted}
              />
            </TouchableOpacity>
          </View>
        )}

        {/* Search input */}
        <ThemedView style={styles.searchContainer}>
          <MaterialIcons
            name="search"
            size={20}
            color={colors.textMuted}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder={t('items.searchPlaceholder')}
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            autoCorrect={false}
            autoCapitalize="none"
            multiline={false}
            numberOfLines={1}
            onChangeText={setSearchQuery}
            clearButtonMode={Platform.OS === 'ios' ? 'while-editing' : 'never'}
            testID="search-input"
          />
          {Platform.OS === 'android' && searchQuery.length > 0 && (
            <TouchableOpacity
              style={styles.clearButton}
              onPress={() => setSearchQuery('')}
              testID="clear-search-button"
            >
              <ThemedText style={styles.clearButtonText}>×</ThemedText>
            </TouchableOpacity>
          )}
        </ThemedView>

        {/* Folder pills (shown below search when not searching) */}
        {!searchQuery && (
          <View style={styles.folderPillsContainer}>
            {foldersWithCounts.map((folder) => (
              <FolderPill
                key={folder.id}
                folder={folder}
                onPress={() => handleFolderClick(folder.id)}
              />
            ))}
            <TouchableOpacity
              style={styles.newFolderButton}
              onPress={() => setShowFolderModal(true)}
            >
              <MaterialIcons name="create-new-folder" size={16} color={colors.textMuted} />
              <Text style={styles.newFolderButtonText}>{t('items.folders.newFolder')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ThemedView>
    );
  };

  /**
   * Render empty state.
   */
  const renderEmptyComponent = (): React.ReactNode => {
    if (isLoadingItems) {
      return null;
    }

    /**
     * Determine the appropriate message based on search and filter state.
     */
    const getMessage = (): string => {
      // Both search and filter active
      if (searchQuery && filterType !== 'all') {
        return t('items.noMatchingItemsWithFilter', { filter: getFilterTitle(), search: searchQuery });
      }
      // Only search active
      if (searchQuery) {
        return t('items.noMatchingItemsSearch', { search: searchQuery });
      }
      // Only filter active (no search)
      if (filterType === 'passkeys') {
        return t('items.noPasskeysFound');
      }
      if (filterType === 'attachments') {
        return t('items.noAttachmentsFound');
      }
      if (isItemTypeFilter(filterType)) {
        return t('items.noItemsOfTypeFound', { type: getFilterTitle() });
      }
      // All items are in folders - show helpful message
      if (hasItemsInFoldersOnly) {
        return t('items.allItemsInFolders');
      }
      // No search, no filter - truly empty vault
      return t('items.noItemsFound');
    };

    const showClearButtons = searchQuery || filterType !== 'all';

    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>{getMessage()}</Text>

        {/* Clear search/filter buttons */}
        {showClearButtons && (
          <View style={styles.clearButtonsContainer}>
            {searchQuery && (
              <TouchableOpacity
                style={styles.clearSearchButton}
                onPress={() => setSearchQuery('')}
              >
                <MaterialIcons name="close" size={16} color={colors.text} />
                <Text style={styles.clearSearchButtonText}>{t('items.clearSearch')}</Text>
              </TouchableOpacity>
            )}
            {filterType !== 'all' && (
              <TouchableOpacity
                style={styles.clearFilterButton}
                onPress={() => setFilterType('all')}
              >
                <MaterialIcons name="close" size={16} color={colors.primary} />
                <Text style={styles.clearFilterButtonText}>{t('items.clearFilter')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    );
  };

  /**
   * Render list footer with clear filter/search buttons.
   * Only shown when there are items and a filter or search is active.
   */
  const renderListFooter = (): React.ReactNode => {
    // Don't show footer if loading, no items, or no active filter/search
    if (isLoadingItems || filteredItems.length === 0 || (filterType === 'all' && !searchQuery)) {
      return null;
    }

    return (
      <View style={styles.footerClearContainer}>
        {searchQuery && (
          <TouchableOpacity
            style={styles.clearSearchButton}
            onPress={() => setSearchQuery('')}
          >
            <MaterialIcons name="close" size={16} color={colors.text} />
            <Text style={styles.clearSearchButtonText}>{t('items.clearSearch')}</Text>
          </TouchableOpacity>
        )}
        {filterType !== 'all' && (
          <TouchableOpacity
            style={styles.clearFilterButton}
            onPress={() => setFilterType('all')}
          >
            <MaterialIcons name="close" size={16} color={colors.primary} />
            <Text style={styles.clearFilterButtonText}>{t('items.clearFilter')}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <ThemedContainer style={styles.container} testID="items-screen">
      <CollapsibleHeader
        title={getFilterTitle()}
        scrollY={scrollY}
        showNavigationHeader={true}
        alwaysVisible={true}
      />
      <ThemedView style={styles.stepContainer}>
        {/* FAB */}
        <RobustPressable style={styles.fab} onPress={handleAddItem} testID="add-item-button">
          <MaterialIcons name="add" style={styles.fabIcon} />
        </RobustPressable>

        {/* Item list */}
        <Animated.FlatList
          ref={flatListRef}
          testID="items-list"
          data={isLoadingItems ? Array(4).fill(null) : sortedItems}
          keyExtractor={(itm, index) => itm?.Id ?? `skeleton-${index}`}
          keyboardShouldPersistTaps='handled'
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: true }
          )}
          scrollEventThrottle={16}
          contentContainerStyle={styles.contentContainer}
          scrollIndicatorInsets={{ bottom: 40 }}
          initialNumToRender={14}
          maxToRenderPerBatch={14}
          windowSize={7}
          removeClippedSubviews={false}
          ListHeaderComponent={renderListHeader() as React.ReactElement}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item: itm }) =>
            isLoadingItems ? (
              <SkeletonLoader count={1} height={60} parts={2} />
            ) : (
              <ItemCard item={itm} onItemDelete={onItemDelete} />
            )
          }
          ListEmptyComponent={renderEmptyComponent() as React.ReactElement}
          ListFooterComponent={renderListFooter() as React.ReactElement}
        />
      </ThemedView>

      {/* Filter menu overlay */}
      {renderFilterOverlay()}

      {/* Sort menu overlay */}
      {showSortMenu && (
        <>
          <TouchableOpacity
            style={styles.sortMenuBackdrop}
            activeOpacity={1}
            onPress={() => setShowSortMenu(false)}
          />
          <ThemedView style={styles.sortMenuOverlay}>
            {SORT_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.filterMenuItem,
                  styles.filterMenuItemWithIcon
                ]}
                onPress={async () => {
                  setSortOrder(option.value);
                  setShowSortMenu(false);
                  // Save to settings and trigger vault sync
                  await executeVaultMutation(async () => {
                    await dbContext.sqliteClient?.settings.setCredentialsSortOrder(option.value);
                  });
                }}
              >
                {sortOrder === option.value ? (
                  <MaterialIcons
                    name="check"
                    size={18}
                    color={colors.primary}
                    style={styles.filterMenuItemIcon}
                  />
                ) : (
                  <View style={styles.filterMenuItemIcon} />
                )}
                <ThemedText style={[
                  styles.filterMenuItemText,
                  sortOrder === option.value && styles.filterMenuItemTextActive
                ]}>
                  {t(option.labelKey)}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </ThemedView>
        </>
      )}

      {/* Create folder modal */}
      <FolderModal
        isOpen={showFolderModal}
        onClose={() => setShowFolderModal(false)}
        onSave={handleCreateFolder}
        mode="create"
      />

      {/* Alert dialog */}
      <ConfirmDialog
        isVisible={alertConfig !== null}
        title={alertConfig?.title ?? ''}
        message={alertConfig?.message ?? ''}
        buttons={[{ text: t('common.ok'), style: 'default', onPress: hideAlert }]}
        onClose={hideAlert}
      />
    </ThemedContainer>
  );
}
