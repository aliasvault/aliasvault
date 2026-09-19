import { scopedKey, type ItemRef } from '@aliasvault/client/database/ItemRef';
import { canHaveSubfolders, getRecursiveItemCount, isSharedFolder } from '@aliasvault/client/items/FolderUtils';
import { applyTypeFilter, isItemTypeFilter, parseItemFilterType, type ItemFilterType } from '@aliasvault/client/items/ItemFilters';
import { getFieldValue, FieldKey, ItemTypes } from '@aliasvault/models/vault';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useNavigation, useRouter, useLocalSearchParams } from 'expo-router';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Platform, View, Text, TextInput, TouchableOpacity, RefreshControl, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import type { DisplayItem } from '@/utils/DisplayItem';
import emitter from '@/utils/EventEmitter';
import { folderRoute } from '@/utils/FolderRoute';
import { HapticsUtility } from '@/utils/HapticsUtility';
import { VaultAuthenticationError } from '@/utils/types/errors/VaultAuthenticationError';

import { useColors } from '@/hooks/useColorScheme';
import { useItemSort, useSortedItems } from '@/hooks/useItemSort';
import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';
import { useNavigationDebounce } from '@/hooks/useNavigationDebounce';
import { usePersonalManifestId } from '@/hooks/usePersonalManifestId';
import { useVaultMutate } from '@/hooks/useVaultMutate';
import { useVaultSync } from '@/hooks/useVaultSync';

import { DeleteFolderModal } from '@/components/folders/DeleteFolderModal';
import { FolderBreadcrumb } from '@/components/folders/FolderBreadcrumb';
import { FolderModal } from '@/components/folders/FolderModal';
import { FolderPill } from '@/components/folders/FolderPill';
import { AddItemFab } from '@/components/items/AddItemFab';
import { ItemCard } from '@/components/items/ItemCard';
import { SortMenu } from '@/components/items/SortMenu';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { SkeletonLoader } from '@/components/ui/SkeletonLoader';
import { useApp } from '@/context/AppContext';
import { useDb } from '@/context/DbContext';
import { useDialog } from '@/context/DialogContext';

import type { FolderWithCount } from '@/components/folders/FolderPill';
import type { ItemSummary } from '@aliasvault/client/database/mappers/ItemMapper';
import type { Folder, FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';
import type { CredentialSortOrder } from '@aliasvault/client/database/repositories/SettingsRepository';
import type { ItemType } from '@aliasvault/models/vault';

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
 * Folder view screen - displays items within a specific folder.
 * Simplified view with search scoped to this folder only.
 */
export default function FolderViewScreen(): React.ReactNode {
  const { id: folderId, manifestId, filter: filterParam } = useLocalSearchParams<{ manifestId: string; id: string; filter?: string }>();
  const folderRef = useMemo((): FolderRef => ({ Id: folderId, ManifestId: manifestId }), [folderId, manifestId]);
  const { syncVault } = useVaultSync();
  const colors = useColors();
  const { t } = useTranslation();
  const navigation = useNavigation();
  const router = useRouter();
  const navigate = useNavigationDebounce();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList<DisplayItem | null>>(null);

  const [itemsList, setItemsList] = useState<DisplayItem[]>([]);
  const [itemSummaries, setItemSummaries] = useState<ItemSummary[]>([]);
  const [folder, setFolder] = useState<Folder | null>(null);
  const [canCreateSubfolder, setCanCreateSubfolder] = useState(false);
  const [allFolders, setAllFolders] = useState<Folder[]>([]);
  const personalManifestId = usePersonalManifestId();
  const [isLoadingItems, setIsLoadingItems] = useState(true);
  const [refreshing, setRefreshing] = useMinDurationLoading(false, 200);
  const { executeVaultMutation } = useVaultMutate();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<ItemFilterType>(() => parseItemFilterType(filterParam));
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const { sortOrder, setSortOrder, showSortMenu, setShowSortMenu, toggleSortMenu } = useItemSort();
  const [highlightedItemKey, setHighlightedItemKey] = useState<string | null>(null);
  const [showEditFolderModal, setShowEditFolderModal] = useState(false);
  const [showDeleteFolderModal, setShowDeleteFolderModal] = useState(false);
  const [showCreateSubfolderModal, setShowCreateSubfolderModal] = useState(false);

  const authContext = useApp();
  const dbContext = useDb();
  const { showAlert } = useDialog();

  const isAuthenticated = authContext.isLoggedIn;
  const isDatabaseAvailable = dbContext.dbAvailable;

  /**
   * Get the title based on the active filter.
   * Shows "Items" for 'all' filter since folder name is already in the navigation header.
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
   * Filter items by search query and type (within this folder only).
   */
  const filteredItems = useMemo(() => {
    const typeFiltered = applyTypeFilter(itemsList, filterType);

    const searchLower = searchQuery.toLowerCase().trim();
    if (!searchLower) {
      return typeFiltered;
    }

    const searchWords = searchLower.split(/\s+/).filter(word => word.length > 0);

    return typeFiltered.filter(item => {
      const searchableFields = [
        item.Name?.toLowerCase() || '',
        getFieldValue(item, FieldKey.LoginUsername)?.toLowerCase() || '',
        getFieldValue(item, FieldKey.LoginEmail)?.toLowerCase() || '',
        getFieldValue(item, FieldKey.LoginUrl)?.toLowerCase() || '',
        getFieldValue(item, FieldKey.NotesContent)?.toLowerCase() || '',
      ];

      return searchWords.every(word =>
        searchableFields.some(field => field.includes(word))
      );
    });
  }, [itemsList, searchQuery, filterType]);

  /**
   * Sort the filtered items based on the current sort order.
   */
  const sortedItems = useSortedItems(filteredItems, sortOrder);

  /**
   * Calculate total item count including all items in current folder and all child folders recursively.
   * Used for the delete folder modal to show accurate count.
   */
  const totalItemCountInFolderTree = useMemo(() => {
    if (allFolders.length === 0) {
      return 0;
    }

    return getRecursiveItemCount(folderRef, itemSummaries, allFolders);
  }, [folderRef, allFolders, itemSummaries]);

  /**
   * Direct subfolders of the current folder, with item counts that respect the active
   * type/feature filter so each badge matches what the user will see when opening the folder.
   */
  const subfolders = useMemo((): FolderWithCount[] => {
    if (allFolders.length === 0) {
      return [];
    }

    const itemsForCount = applyTypeFilter(itemSummaries, filterType);

    const childFolders = allFolders.filter((f: Folder) => f.ParentFolderId === folderRef.Id && f.ManifestId === folderRef.ManifestId);
    return childFolders.map((f) => ({
      id: f.Id,
      manifestId: f.ManifestId,
      name: f.Name,
      itemCount: getRecursiveItemCount(f, itemsForCount, allFolders),
      isShared: isSharedFolder(f, personalManifestId),
    }));
  }, [folderRef, allFolders, itemSummaries, filterType, personalManifestId]);

  /**
   * Load items in this folder, subfolders, and folder details.
   */
  const loadItems = useCallback(async (): Promise<void> => {
    try {
      const [folderItems, summaries, folders, savedSortOrder] = await Promise.all([
        dbContext.sqliteClient!.items.getByFolder(folderRef),
        dbContext.sqliteClient!.items.getAllSummaries(),
        dbContext.sqliteClient!.folders.getAll(),
        dbContext.sqliteClient!.settings.getCredentialsSortOrder()
      ]);
      setItemsList(folderItems);
      setItemSummaries(summaries);

      // Find this folder
      const currentFolder = folders.find((f: Folder) => f.Id === folderRef.Id && f.ManifestId === folderRef.ManifestId);
      setFolder(currentFolder || null);

      setAllFolders(folders);

      // Calculate if we can create subfolders (check depth)
      setCanCreateSubfolder(canHaveSubfolders(folderRef, folders));

      setSortOrder(savedSortOrder);
      setIsLoadingItems(false);
    } catch (err) {
      console.error('Error loading folder items:', err);
      Toast.show({
        type: 'error',
        text1: t('items.errorLoadingItems'),
        text2: t('common.errors.unknownError'),
      });
      setIsLoadingItems(false);
    }
  }, [dbContext.sqliteClient, folderRef, setIsLoadingItems, setSortOrder, t]);

  useEffect(() => {
    // Add listener for item changes
    const itemChangedSub = emitter.addListener('itemChanged', async () => {
      await loadItems();
    });

    return (): void => {
      itemChangedSub.remove();
    };
  }, [loadItems]);

  /**
   * Handle pull-to-refresh.
   */
  const onRefresh = useCallback(async () => {
    HapticsUtility.impact();

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
         * On offline - just set offline mode, ServerSyncIndicator shows status.
         */
        onOffline: () => {
          setRefreshing(false);
          setIsLoadingItems(false);
          authContext.setOfflineMode(true);
        },
        /**
         * On error.
         */
        onError: async (error) => {
          console.error('Error syncing vault:', error);
          setRefreshing(false);
          setIsLoadingItems(false);
          showAlert(t('common.error'), error);
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
  }, [syncVault, loadItems, setIsLoadingItems, setRefreshing, authContext, dbContext, router, showAlert, t]);

  useEffect(() => {
    if (!isAuthenticated || !isDatabaseAvailable) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing loading state with async data fetch on auth/db readiness
    setIsLoadingItems(true);
    loadItems();
  }, [isAuthenticated, isDatabaseAvailable, loadItems, setIsLoadingItems]);

  /**
   * Set up header with folder name and edit/delete buttons.
   */
  useEffect(() => {
    navigation.setOptions({
      title: folder?.Name || t('items.folders.folder'),
      /**
       * Header right buttons for edit and delete.
       */
      headerRight: (): React.ReactNode => (
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <RobustPressable
            onPress={() => setShowEditFolderModal(true)}
            style={{ padding: 8 }}
          >
            <MaterialIcons
              name="edit"
              size={Platform.OS === 'android' ? 24 : 22}
              color={colors.primary}
            />
          </RobustPressable>
          <RobustPressable
            onPress={() => setShowDeleteFolderModal(true)}
            style={{ padding: 8 }}
          >
            <MaterialIcons
              name="delete"
              size={Platform.OS === 'android' ? 24 : 22}
              color={colors.destructive}
            />
          </RobustPressable>
        </View>
      ),
    });
  }, [navigation, folder?.Name, colors.primary, colors.destructive, t]);

  /**
   * Delete an item (move to trash).
   * Non-blocking: saves locally and syncs in background via ServerSyncIndicator.
   */
  const onItemDelete = useCallback(async (item: ItemRef): Promise<void> => {
    await executeVaultMutation(async () => {
      await dbContext.sqliteClient!.items.trash(item);
    });

    // Reload items to reflect the deletion
    await loadItems();
  }, [dbContext.sqliteClient, executeVaultMutation, loadItems]);

  /**
   * Duplicate an item including all fields except passkeys and field history.
   */
  const onItemDuplicate = useCallback(async (item: ItemRef): Promise<void> => {
    let duplicate: ItemRef | null = null;
    await executeVaultMutation(async () => {
      duplicate = await dbContext.sqliteClient!.items.duplicate(item);
    });

    // Reload items to show the new duplicate
    await loadItems();

    // Scroll to and briefly highlight the new duplicate so it's clear where it landed
    const created = duplicate as ItemRef | null;
    setHighlightedItemKey(created ? scopedKey(created.ManifestId, created.Id) : null);
  }, [dbContext.sqliteClient, executeVaultMutation, loadItems]);

  /**
   * Scroll the highlighted item (a freshly created duplicate) into view once it's
   * rendered, then clear the highlight after a short moment.
   */
  useEffect(() => {
    if (!highlightedItemKey) {
      return;
    }

    const index = sortedItems.findIndex(itm => scopedKey(itm.ManifestId, itm.Id) === highlightedItemKey);
    if (index >= 0) {
      flatListRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
    }

    const timer = setTimeout(() => setHighlightedItemKey(null), 2000);
    return (): void => clearTimeout(timer);
  }, [highlightedItemKey, sortedItems]);

  /**
   * Rename the folder.
   */
  const handleEditFolder = useCallback(async (newName: string) => {
    await executeVaultMutation(async () => {
      await dbContext.sqliteClient!.folders.update(folderRef, newName);
    });
    await loadItems();
    setShowEditFolderModal(false);
  }, [dbContext.sqliteClient, folderRef, executeVaultMutation, loadItems]);

  /**
   * Delete the folder (keep items - move them to root).
   */
  const handleDeleteFolderOnly = useCallback(async () => {
    await executeVaultMutation(async () => {
      await dbContext.sqliteClient!.folders.delete(folderRef);
    });
    // Emit event to refresh the home screen folder list
    emitter.emit('itemChanged');
    router.back();
  }, [dbContext.sqliteClient, folderRef, executeVaultMutation, router]);

  /**
   * Delete the folder and all its contents.
   */
  const handleDeleteFolderAndContents = useCallback(async () => {
    await executeVaultMutation(async () => {
      await dbContext.sqliteClient!.folders.deleteWithContents(folderRef);
    });
    // Emit event to refresh the home screen folder list
    emitter.emit('itemChanged');
    router.back();
  }, [dbContext.sqliteClient, folderRef, executeVaultMutation, router]);

  /**
   * Handle item type selection from the FAB menu.
   */
  const handleAddItem = useCallback((itemType: ItemType) => {
    navigate(() => {
      router.push(`/(tabs)/items/add?folderId=${folderRef.Id}&folderManifestId=${encodeURIComponent(folderRef.ManifestId)}&itemType=${itemType}` as '/(tabs)/items/add');
      HapticsUtility.impact();
    });
  }, [folderRef, router, navigate]);

  /**
   * Handle subfolder click.
   */
  const handleSubfolderClick = useCallback((subfolder: FolderRef) => {
    navigate(() => {
      router.push(folderRoute(subfolder, filterType));
    });
  }, [router, navigate, filterType]);

  /**
   * Create a new subfolder.
   */
  const handleCreateSubfolder = useCallback(async (name: string) => {
    await executeVaultMutation(async () => {
      await dbContext.sqliteClient!.folders.create(name, folderRef);
    });
    await loadItems();
    setShowCreateSubfolderModal(false);
  }, [dbContext.sqliteClient, folderRef, executeVaultMutation, loadItems]);

  const paddingTop = Platform.OS === 'ios' ? 56 : 16;
  const paddingBottom = Platform.OS === 'ios' ? insets.bottom + 60 : 40;

  const styles = useMemo(() => StyleSheet.create({
    container: {
      paddingHorizontal: 0,
    },
    contentContainer: {
      paddingBottom: paddingBottom,
      paddingHorizontal: 14,
      paddingTop: paddingTop,
    },
    // Search styles
    searchContainer: {
      position: 'relative',
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
      fontSize: 22,
      fontWeight: 'bold',
      lineHeight: 28,
    },
    filterCount: {
      color: colors.textMuted,
      fontSize: 16,
      lineHeight: 22,
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
      top: Platform.OS === 'ios' ? paddingTop + 104 : paddingTop +44,
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
    // Empty state styles
    emptyText: {
      color: colors.textMuted,
      fontSize: 16,
      marginTop: 24,
      opacity: 0.7,
      textAlign: 'center',
    },
    emptyHint: {
      color: colors.textMuted,
      fontSize: 14,
      marginTop: 8,
      opacity: 0.6,
      textAlign: 'center',
      paddingHorizontal: 32,
    },
    // Subfolder pills styles
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
  }), [colors, paddingTop, paddingBottom]);

  /**
   * Render the filter menu as an absolute overlay.
   */
  const renderFilterOverlay = (): React.ReactNode => {
    if (!showFilterMenu) {
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
        </ThemedView>
      </>
    );
  };

  /**
   * The list header with subfolders, filter, sort button, and search.
   */
  const listHeader = useMemo((): React.ReactElement => {
    return (
      <ThemedView>
        {/* Folder breadcrumb navigation */}
        <FolderBreadcrumb
          folder={folderRef}
          excludeCurrentFolder={true}
          folders={allFolders}
        />

        {/* Subfolder pills (shown when not searching) */}
        {!searchQuery && subfolders.length > 0 && (
          <View style={styles.folderPillsContainer}>
            {subfolders.map((subfolder) => (
              <FolderPill
                key={scopedKey(subfolder.manifestId, subfolder.id)}
                folder={subfolder}
                onPress={() => handleSubfolderClick({ Id: subfolder.id, ManifestId: subfolder.manifestId })}
              />
            ))}
            {canCreateSubfolder && (
              <TouchableOpacity
                style={styles.newFolderButton}
                onPress={() => setShowCreateSubfolderModal(true)}
              >
                <MaterialIcons name="create-new-folder" size={16} color={colors.textMuted} />
                <Text style={styles.newFolderButtonText}>{t('items.folders.newFolder')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Create subfolder button (when no subfolders exist) */}
        {!searchQuery && subfolders.length === 0 && canCreateSubfolder && (
          <View style={styles.folderPillsContainer}>
            <TouchableOpacity
              style={styles.newFolderButton}
              onPress={() => setShowCreateSubfolderModal(true)}
            >
              <MaterialIcons name="create-new-folder" size={16} color={colors.textMuted} />
              <Text style={styles.newFolderButtonText}>{t('items.folders.newFolder')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Header row with filter dropdown and sort button */}
        <View style={styles.headerRow}>
          {/* Filter button */}
          <TouchableOpacity
            style={styles.filterButton}
            onPress={() => setShowFilterMenu(!showFilterMenu)}
          >
            <ThemedText style={styles.filterButtonText}>
              {getFilterTitle()}
            </ThemedText>
            <ThemedText style={styles.filterCount}>
              ({filteredItems.length})
            </ThemedText>
            <MaterialIcons
              name={showFilterMenu ? "keyboard-arrow-up" : "keyboard-arrow-down"}
              size={24}
              color={colors.text}
            />
          </TouchableOpacity>
          {/* Sort button */}
          <TouchableOpacity
            style={styles.sortButton}
            onPress={toggleSortMenu}
          >
            <MaterialIcons
              name="sort"
              size={24}
              color={colors.textMuted}
            />
          </TouchableOpacity>
        </View>

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
          />
          {Platform.OS === 'android' && searchQuery.length > 0 && (
            <TouchableOpacity
              style={styles.clearButton}
              onPress={() => setSearchQuery('')}
            >
              <ThemedText style={styles.clearButtonText}>×</ThemedText>
            </TouchableOpacity>
          )}
        </ThemedView>
      </ThemedView>
    );
  }, [folderRef, allFolders, searchQuery, subfolders, canCreateSubfolder, handleSubfolderClick, showFilterMenu, filteredItems.length, getFilterTitle, toggleSortMenu, styles, colors, t]);

  /**
   * Render empty state.
   */
  const renderEmptyComponent = (): React.ReactNode => {
    if (isLoadingItems) {
      return null;
    }

    return (
      <View>
        {searchQuery.length > 0 ? (
          <Text style={styles.emptyText}>
            {t('items.noMatchingItems')}
          </Text>
        ) : (
          <Text style={styles.emptyHint}>
            {t('items.folders.emptyFolderHint')}
          </Text>
        )}
      </View>
    );
  };

  return (
    <ThemedContainer style={styles.container}>
      {/* Item list */}
      <FlatList
        ref={flatListRef}
        data={isLoadingItems ? Array(4).fill(null) : sortedItems}
        keyExtractor={(itm, index) => itm ? scopedKey(itm.ManifestId, itm.Id) : `skeleton-${index}`}
        keyboardShouldPersistTaps='handled'
        contentContainerStyle={styles.contentContainer}
        scrollIndicatorInsets={{ bottom: 40 }}
        initialNumToRender={14}
        maxToRenderPerBatch={14}
        windowSize={7}
        removeClippedSubviews={false}
        ListHeaderComponent={listHeader}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          flatListRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: true });
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
            progressViewOffset={Platform.OS === 'ios' ? 44 : undefined}
          />
        }
        renderItem={({ item: itm }) =>
          isLoadingItems ? (
            <SkeletonLoader count={1} height={60} parts={2} />
          ) : (
            <ItemCard item={itm} onItemDelete={onItemDelete} onItemDuplicate={onItemDuplicate} isHighlighted={scopedKey(itm.ManifestId, itm.Id) === highlightedItemKey} />
          )
        }
        ListEmptyComponent={renderEmptyComponent() as React.ReactElement}
      />

      {/* FAB with item type menu */}
      <AddItemFab onSelectType={handleAddItem} />

      {/* Filter menu overlay */}
      {renderFilterOverlay()}

      {/* Sort menu overlay */}
      <SortMenu
        visible={showSortMenu}
        sortOrder={sortOrder}
        onSelect={async (order: CredentialSortOrder) => {
          setSortOrder(order);
          // Save to settings and trigger vault sync
          await executeVaultMutation(async () => {
            await dbContext.sqliteClient?.settings.setCredentialsSortOrder(order);
          });
        }}
        onClose={() => setShowSortMenu(false)}
        topOffset={Platform.OS === 'ios' ? paddingTop + 104 : paddingTop + 44}
      />

      {/* Folder modals */}
      <FolderModal
        isOpen={showEditFolderModal}
        onClose={() => setShowEditFolderModal(false)}
        onSave={handleEditFolder}
        initialName={folder?.Name || ''}
        mode="edit"
      />
      <FolderModal
        isOpen={showCreateSubfolderModal}
        onClose={() => setShowCreateSubfolderModal(false)}
        onSave={handleCreateSubfolder}
        initialName=""
        mode="create"
      />
      <DeleteFolderModal
        isOpen={showDeleteFolderModal}
        onClose={() => setShowDeleteFolderModal(false)}
        onDeleteFolderOnly={handleDeleteFolderOnly}
        onDeleteFolderAndContents={handleDeleteFolderAndContents}
        itemCount={totalItemCountInFolderTree}
      />
    </ThemedContainer>
  );
}
