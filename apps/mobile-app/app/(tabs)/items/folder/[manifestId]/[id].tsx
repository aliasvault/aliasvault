import { scopedKey, type ItemRef } from '@aliasvault/client/database/ItemRef';
import { selectedItemKey, toSelectedItem } from '@aliasvault/client/items/BulkItemActions';
import { canHaveSubfolders, compareFolderNames, getRecursiveItemCount, isSharedFolder } from '@aliasvault/client/items/FolderUtils';
import { ItemFilter, applySearchFilter, applyTypeFilter, isItemTypeFilter, parseItemFilterType, type ItemFilterType } from '@aliasvault/client/items/ItemFilters';
import { multiManifestRendering } from '@aliasvault/client/sharing/MultiManifestRendering';
import { SharingService } from '@aliasvault/client/sharing/SharingService';
import { canAdministerGroup, sharingText, holdsManifestKey, MAX_SHARED_VAULT_NAME_LENGTH } from '@aliasvault/client/sharing/SharingView';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Stack } from 'expo-router';
import { useVerticalBarEdgeIOS } from 'expo-status-bar';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Platform, View, Text, TextInput, TouchableOpacity, RefreshControl, FlatList } from 'react-native';
import { toast } from 'sonner-native';

import type { DisplayItem } from '@/utils/DisplayItem';
import emitter from '@/utils/EventEmitter';
import { folderRoute } from '@/utils/FolderRoute';
import { HapticsUtility } from '@/utils/HapticsUtility';
import { itemRoute } from '@/utils/ItemRoute';
import { runSharingOperation, sharingFailureMessage } from '@/utils/SharingErrors';

import { useColors } from '@/hooks/useColorScheme';
import { useHeaderInset } from '@/hooks/useHeaderInset';
import { SORT_OPTIONS, useItemSort, useSortedItems } from '@/hooks/useItemSort';
import { useLayoutChangeCache } from '@/hooks/useLayoutChangeCache';
import { useListSelection } from '@/hooks/useListSelection';
import { useNavigationDebounce } from '@/hooks/useNavigationDebounce';
import { usePaneRouter } from '@/hooks/usePaneRouter';
import { usePaneHeaderViews } from '@/hooks/usePaneStack';
import { usePasswordConfirmedAction } from '@/hooks/usePasswordConfirmedAction';
import { usePersonalManifestId } from '@/hooks/usePersonalManifestId';
import { useScreenParams } from '@/hooks/useScreenParams';
import { useScrollSelectedIntoFlatList } from '@/hooks/useScrollSelectedIntoView';
import { useSharedFolders } from '@/hooks/useSharedFolders';
import { useIsStackRoute, useSetScreenOptions } from '@/hooks/useTwoPane';
import { useVaultMutate } from '@/hooks/useVaultMutate';
import { useVaultRefresh } from '@/hooks/useVaultRefresh';
import { useVaultSync } from '@/hooks/useVaultSync';

import { ListMenu, type ListMenuAction } from '@/components/common/ListMenu';
import { SELECTION_BAR_SPACE } from '@/components/common/SelectionBar';
import { DeleteFolderModal } from '@/components/folders/DeleteFolderModal';
import { FolderBreadcrumb } from '@/components/folders/FolderBreadcrumb';
import { FolderModal } from '@/components/folders/FolderModal';
import { FolderPill } from '@/components/folders/FolderPill';
import { AddItemFab } from '@/components/items/AddItemFab';
import { ItemCard } from '@/components/items/ItemCard';
import { ItemSelectionBar } from '@/components/items/ItemSelectionBar';
import { SharedFolderAccessModal } from '@/components/sharing/SharedFolderAccessModal';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { ScreenToolbar } from '@/components/ui/ScreenToolbar';
import { SkeletonLoader } from '@/components/ui/SkeletonLoader';
import { useApp } from '@/context/AppContext';
import { useDb } from '@/context/DbContext';
import { useDialog } from '@/context/DialogContext';
import { useWebApi } from '@/context/WebApiContext';

import type { FolderWithCount } from '@/components/folders/FolderPill';
import type { ItemSummary } from '@aliasvault/client/database/mappers/ItemMapper';
import type { Folder, FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';
import type { CredentialSortOrder } from '@aliasvault/client/database/repositories/SettingsRepository';
import type { ItemType } from '@aliasvault/models/vault';

/**
 * Item type filter option configuration.
 */
type ItemTypeOption = {
  type: ItemFilterType;
  titleKey: string;
  iconName: keyof typeof MaterialIcons.glyphMap;
  sfSymbol: Extract<React.ComponentProps<typeof Stack.Toolbar.MenuAction>['icon'], string>;
};

/**
 * Available item type filter options with icons.
 */
const ITEM_TYPE_OPTIONS: ItemTypeOption[] = [
  { type: ItemFilter.Login, titleKey: 'itemTypes.login.title', iconName: 'key', sfSymbol: 'key' },
  { type: ItemFilter.Alias, titleKey: 'itemTypes.alias.title', iconName: 'person', sfSymbol: 'person' },
  { type: ItemFilter.CreditCard, titleKey: 'itemTypes.creditCard.title', iconName: 'credit-card', sfSymbol: 'creditcard' },
  { type: ItemFilter.Note, titleKey: 'itemTypes.note.title', iconName: 'description', sfSymbol: 'doc.text' },
];

/**
 * Folder view screen - displays items within a specific folder.
 * Simplified view with search scoped to this folder only.
 */
export default function FolderViewScreen(): React.ReactNode {
  const { id: folderId, manifestId, filter: filterParam, name: nameParam } = useScreenParams<{ manifestId: string; id: string; filter?: string; name?: string }>();
  const folderRef = useMemo((): FolderRef => ({ Id: folderId, ManifestId: manifestId }), [folderId, manifestId]);
  const colors = useColors();
  const { t } = useTranslation();
  const isStackRoute = useIsStackRoute();
  const setScreenOptions = useSetScreenOptions();
  // On the iPhone Duo rail the filter and list menus move into the rail, so the content skips its own heading row.
  const hasRail = useVerticalBarEdgeIOS() !== null && isStackRoute;
  const router = usePaneRouter();
  const navigate = useNavigationDebounce();
  const flatListRef = useRef<FlatList<DisplayItem | null>>(null);

  const { cached, save: saveLoaded } = useLayoutChangeCache<{ items: DisplayItem[]; summaries: ItemSummary[]; folders: Folder[]; folder: Folder | null; sortOrder: CredentialSortOrder }>(`folder/${manifestId}/${folderId}`);
  const [itemsList, setItemsList] = useState<DisplayItem[]>(cached?.items ?? []);
  const [itemSummaries, setItemSummaries] = useState<ItemSummary[]>(cached?.summaries ?? []);
  const [folder, setFolder] = useState<Folder | null>(cached?.folder ?? null);
  const [canCreateSubfolder, setCanCreateSubfolder] = useState(() => cached !== undefined && canHaveSubfolders(folderRef, cached.folders));
  const [allFolders, setAllFolders] = useState<Folder[]>(cached?.folders ?? []);
  const personalManifestId = usePersonalManifestId();
  const [isLoadingItems, setIsLoadingItems] = useState(cached === undefined);
  const { executeVaultMutation } = useVaultMutate();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<ItemFilterType>(() => parseItemFilterType(filterParam));
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const { sortOrder, setSortOrder, showSortMenu, setShowSortMenu, toggleSortMenu } = useItemSort(cached?.sortOrder);
  const [highlightedItemKey, setHighlightedItemKey] = useState<string | null>(null);
  const [showEditFolderModal, setShowEditFolderModal] = useState(false);
  const [showDeleteFolderModal, setShowDeleteFolderModal] = useState(false);
  const [showCreateSubfolderModal, setShowCreateSubfolderModal] = useState(false);
  /** The folder whose people sheet is open; kept while the folder turns into a shared one or a personal one and the screen moves to it. */
  const [peopleFolder, setPeopleFolder] = useState<{ folder: Folder; isShared: boolean } | null>(null);
  const shared = useSharedFolders();
  const reloadShared = shared.reload;
  const webApi = useWebApi();
  const { syncVault } = useVaultSync();
  const { showConfirm } = useDialog();
  const runWithPassword = usePasswordConfirmedAction();

  const authContext = useApp();
  const dbContext = useDb();

  const isAuthenticated = authContext.isLoggedIn;
  const isDatabaseAvailable = dbContext.dbAvailable;

  /**
   * Get the title based on the active filter.
   * Shows "Items" for the All filter since folder name is already in the navigation header.
   */
  const getFilterTitle = useCallback((): string => {
    switch (filterType) {
      case ItemFilter.Passkeys:
        return t('common.passkeys');
      case ItemFilter.Attachments:
        return t('common.attachments');
      case ItemFilter.All:
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
    return applySearchFilter(typeFiltered, searchQuery);
  }, [itemsList, searchQuery, filterType]);

  /**
   * Sort the filtered items based on the current sort order.
   */
  const sortedItems = useSortedItems(filteredItems, sortOrder);

  const selection = useListSelection(sortedItems, toSelectedItem, selectedItemKey);
  const { exit: exitSelection, toggle: toggleSelected, enter: enterSelection } = selection;

  /**
   * Turn selection mode on or off from the list menu.
   */
  const toggleSelectionMode = useCallback((): void => (selection.isActive ? exitSelection() : selection.enter()), [selection, exitSelection]);

  /**
   * Toggle one row from a tap or long-press.
   */
  const toggleItem = useCallback((entry: DisplayItem): void => toggleSelected(entry, false), [toggleSelected]);

  /**
   * Start selection mode with one row selected, from its context menu.
   */
  const selectFromMenu = useCallback((entry: DisplayItem): void => enterSelection(entry), [enterSelection]);

  // Exit selection mode when the list changes.
  useEffect(() => {
    exitSelection();
  }, [folderRef, searchQuery, filterType, exitSelection]);

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
    })).sort((a, b) => compareFolderNames(a.name, b.name));
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
      saveLoaded({ items: folderItems, summaries, folders, folder: currentFolder || null, sortOrder: savedSortOrder });
      setIsLoadingItems(false);
    } catch (err) {
      console.error('Error loading folder items:', err);
      toast.error(t('items.errorLoadingItems'), { description: t('common.errors.unknownError') });
      setIsLoadingItems(false);
    }
  }, [dbContext.sqliteClient, folderRef, setIsLoadingItems, setSortOrder, saveLoaded, t]);

  useEffect(() => {
    // Add listener for item changes
    const itemChangedSub = emitter.addListener('itemChanged', async () => {
      await loadItems();
    });
    const itemUsedSub = emitter.addListener('itemUsed', async () => {
      await loadItems();
    });

    return (): void => {
      itemChangedSub.remove();
      itemUsedSub.remove();
    };
  }, [loadItems]);

  const { refreshing, onRefresh } = useVaultRefresh(loadItems, setIsLoadingItems);

  useEffect(() => {
    if (!isAuthenticated || !isDatabaseAvailable) {
      return;
    }

    // With cached data the list is already shown and only refreshes.
    if (cached === undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing loading state with async data fetch on auth/db readiness
      setIsLoadingItems(true);
    }
    loadItems();
  }, [isAuthenticated, isDatabaseAvailable, loadItems, setIsLoadingItems, cached]);

  // A virtual folder (a shared manifest) is renamed and deleted through its shared folder, not as a stored folder.
  const isVirtualFolder = multiManifestRendering.isVirtualFolder(folderRef);
  const currentShared = isVirtualFolder ? shared.folders.find(candidate => candidate.manifest.manifestId.toLowerCase() === folderRef.ManifestId.toLowerCase()) ?? null : null;
  const canManageShared = currentShared !== null && canAdministerGroup(currentShared.group);
  const canEditFolder = !isVirtualFolder || (canManageShared && holdsManifestKey(currentShared.manifest, shared.myUserId));
  const canDeleteFolder = !isVirtualFolder || canManageShared;
  const canShareFolder = shared.isEnabled && folder !== null && (isVirtualFolder || !folder.ParentFolderId);

  /**
   * Delete the shared folder for everyone, after a confirmation and the master password, then go to the vault root.
   */
  const deleteSharedFolder = useCallback((): void => {
    if (!currentShared) {
      return;
    }
    const name = folder?.Name ?? '';
    showConfirm(sharingText.deleteVault, sharingText.deleteVaultConfirm(name), t('common.delete'), async () => {
      try {
        const done = await runWithPassword(sharingText.deleteVault, sharingText.deleteVaultPasswordPrompt(name), t('common.delete'), answerChallenge => (
          SharingService.deleteSharedManifest(webApi, currentShared.group.groupId, currentShared.manifest.manifestId, answerChallenge)
        ));
        if (!done) {
          return;
        }
        await syncVault();
        emitter.emit('itemChanged');
        await reloadShared();
        toast.success(sharingText.vaultDeleted);
        router.dismissTo('/(tabs)/items');
      } catch (deleteError) {
        toast.error(sharingFailureMessage(deleteError, sharingText.errors.deleteVaultFailed));
      }
    }, { confirmStyle: 'destructive' });
  }, [currentShared, folder?.Name, showConfirm, runWithPassword, webApi, syncVault, reloadShared, router, t]);

  /**
   * Set up the header.
   */
  useEffect(() => {
    setScreenOptions({
      title: folder?.Name || nameParam || t('items.folders.folder'),
      ...(Platform.OS === 'android' && {
        /**
         * Header right buttons: share, and the overflow menu.
         */
        headerRight: (): React.ReactNode => (
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {canShareFolder && folder && (
              <RobustPressable onPress={() => setPeopleFolder({ folder, isShared: isVirtualFolder })} style={{ padding: 8 }} accessibilityLabel={t('common.share')}>
                <MaterialIcons name="people" size={24} color={colors.primary} />
              </RobustPressable>
            )}
            <RobustPressable onPress={toggleSortMenu} style={{ padding: 8 }} accessibilityLabel={t('common.moreOptions')}>
              <MaterialIcons name="more-vert" size={24} color={colors.text} />
            </RobustPressable>
          </View>
        ),
      }),
    });
  }, [setScreenOptions, folder, nameParam, isVirtualFolder, canShareFolder, toggleSortMenu, colors.primary, colors.text, t]);

  // The header title comes from the name param until the folder has loaded: keep the param at the loaded name, also after a rename.
  useEffect(() => {
    if (folder && folder.Name !== nameParam) {
      router.setParams({ name: folder.Name });
    }
  }, [folder, nameParam, router]);

  // The pane stack header has no toolbar, so it carries the list menu button instead of the heading row.
  usePaneHeaderViews(useMemo(() => ({
    right: (
      <RobustPressable onPress={toggleSortMenu} style={{ padding: 6 }} accessibilityLabel={t('common.moreOptions')}>
        <MaterialIcons name="more-horiz" size={24} color={colors.text} />
      </RobustPressable>
    ),
  }), [toggleSortMenu, colors.text, t]));

  /**
   * The folder actions in the list menu, on Android and without a route header; elsewhere iOS shows them in the toolbar.
   */
  const folderMenuActions = useMemo((): ListMenuAction[] => {
    if (Platform.OS !== 'android' && isStackRoute) {
      return [];
    }
    const actions: ListMenuAction[] = [];
    if (!isStackRoute && canShareFolder && folder) {
      actions.push({
        label: t('common.share'),
        icon: 'people',
        /**
         * Open the people sheet of the folder.
         */
        onPress: () => setPeopleFolder({ folder, isShared: isVirtualFolder }),
      });
    }
    if (canEditFolder) {
      actions.push({
        label: t('common.edit'),
        icon: 'edit',
        /**
         * Open the edit folder modal.
         */
        onPress: () => setShowEditFolderModal(true),
      });
    }
    if (canDeleteFolder) {
      actions.push({
        label: t('common.delete'),
        icon: 'delete',
        destructive: true,
        /**
         * Delete the shared vault, or open the delete folder modal.
         */
        onPress: () => (isVirtualFolder ? deleteSharedFolder() : setShowDeleteFolderModal(true)),
      });
    }
    return actions;
  }, [isStackRoute, canShareFolder, folder, canEditFolder, canDeleteFolder, isVirtualFolder, deleteSharedFolder, t]);

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

  const scrollSelected = useScrollSelectedIntoFlatList(flatListRef, { rows: sortedItems, isLoaded: !isLoadingItems, rowHref: itemRoute, rowKey: selectedItemKey });
  const { scrollToIndex } = scrollSelected;

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
      scrollToIndex(index, true);
    }

    const timer = setTimeout(() => setHighlightedItemKey(null), 2000);
    return (): void => clearTimeout(timer);
  }, [highlightedItemKey, sortedItems, scrollToIndex]);

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
   * Rename the shared folder: its name is encrypted with its key and kept on the server for every member.
   */
  const handleEditSharedFolder = useCallback(async (newName: string) => {
    if (!currentShared) {
      return;
    }
    await runSharingOperation('updateSharedManifest', { groupId: currentShared.group.groupId, manifestId: currentShared.manifest.manifestId, name: newName }, t('common.errors.unknownErrorTryAgain'));
    await syncVault();
    await loadItems();
    emitter.emit('itemChanged');
  }, [currentShared, syncVault, loadItems, t]);

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
  const handleSubfolderClick = useCallback((subfolder: FolderRef, name?: string) => {
    navigate(() => {
      router.push(folderRoute(subfolder, filterType, name));
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

  const paddingTop = 16;
  const paddingBottom = Platform.OS === 'ios' ? 16 : 40;
  const headerInset = useHeaderInset();
  const menuTopOffset = isStackRoute ? headerInset + paddingTop + 44 : headerInset + 4;

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
    railFilterSummary: {
      color: colors.textMuted,
      fontSize: 13,
      marginBottom: 8,
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
      top: menuTopOffset,
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
  }), [colors, paddingTop, paddingBottom, menuTopOffset]);

  /**
   * Apply a sort order and save it to the vault settings.
   */
  const changeSortOrder = useCallback(async (order: CredentialSortOrder): Promise<void> => {
    setSortOrder(order);
    await executeVaultMutation(async () => {
      await dbContext.sqliteClient?.settings.setCredentialsSortOrder(order);
    });
  }, [setSortOrder, executeVaultMutation, dbContext.sqliteClient]);

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
              filterType === ItemFilter.All && styles.filterMenuItemActive
            ]}
            onPress={() => {
              setFilterType(ItemFilter.All);
              setShowFilterMenu(false);
            }}
          >
            <ThemedText style={[
              styles.filterMenuItemText,
              filterType === ItemFilter.All && styles.filterMenuItemTextActive
            ]}>
              {t('items.title')}
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
              filterType === ItemFilter.Passkeys && styles.filterMenuItemActive
            ]}
            onPress={() => {
              setFilterType(ItemFilter.Passkeys);
              setShowFilterMenu(false);
            }}
          >
            <ThemedText style={[
              styles.filterMenuItemText,
              filterType === ItemFilter.Passkeys && styles.filterMenuItemTextActive
            ]}>
              {t('common.passkeys')}
            </ThemedText>
          </TouchableOpacity>

          {/* Attachments filter */}
          <TouchableOpacity
            style={[
              styles.filterMenuItem,
              filterType === ItemFilter.Attachments && styles.filterMenuItemActive
            ]}
            onPress={() => {
              setFilterType(ItemFilter.Attachments);
              setShowFilterMenu(false);
            }}
          >
            <ThemedText style={[
              styles.filterMenuItemText,
              filterType === ItemFilter.Attachments && styles.filterMenuItemTextActive
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
        {/* Folder breadcrumb navigation; on the pane stack a top-level folder skips it, the back button leads there */}
        {(isStackRoute || !!folder?.ParentFolderId) && (
          <FolderBreadcrumb
            folder={folderRef}
            excludeCurrentFolder={true}
            folders={allFolders}
          />
        )}

        {/* Subfolder pills (shown when not searching) */}
        {!searchQuery && subfolders.length > 0 && (
          <View style={styles.folderPillsContainer}>
            {subfolders.map((subfolder) => (
              <FolderPill
                key={scopedKey(subfolder.manifestId, subfolder.id)}
                folder={subfolder}
                onPress={() => handleSubfolderClick({ Id: subfolder.id, ManifestId: subfolder.manifestId }, subfolder.name)}
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

        {/* Header row with filter dropdown and sort button; on the Duo rail only the active filter and count */}
        {hasRail ? (
          <ThemedText style={styles.railFilterSummary}>{getFilterTitle()} ({filteredItems.length})</ThemedText>
        ) : (
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
            {/* List menu button; Android and the pane stack have it in the header */}
            {Platform.OS === 'ios' && isStackRoute && (
              <TouchableOpacity
                style={styles.sortButton}
                onPress={toggleSortMenu}
                accessibilityLabel={t('common.moreOptions')}
              >
                <MaterialIcons
                  name="more-horiz"
                  size={24}
                  color={colors.textMuted}
                />
              </TouchableOpacity>
            )}
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
  }, [folderRef, folder?.ParentFolderId, isStackRoute, allFolders, searchQuery, subfolders, canCreateSubfolder, handleSubfolderClick, hasRail, showFilterMenu, filteredItems.length, getFilterTitle, toggleSortMenu, styles, colors, t]);

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
      {Platform.OS === 'ios' && (
        <ScreenToolbar placement="right">
          {hasRail && (
            <Stack.Toolbar.Menu icon={filterType === ItemFilter.All ? 'line.3.horizontal.decrease' : 'line.3.horizontal.decrease.circle.fill'} accessibilityLabel={getFilterTitle()}>
              <Stack.Toolbar.Menu inline>
                <Stack.Toolbar.MenuAction isOn={filterType === ItemFilter.All} onPress={() => setFilterType(ItemFilter.All)}>{t('items.title')}</Stack.Toolbar.MenuAction>
              </Stack.Toolbar.Menu>
              <Stack.Toolbar.Menu inline>
                {ITEM_TYPE_OPTIONS.map((option) => (
                  <Stack.Toolbar.MenuAction key={option.type} icon={option.sfSymbol} isOn={filterType === option.type} onPress={() => setFilterType(option.type)}>{t(option.titleKey)}</Stack.Toolbar.MenuAction>
                ))}
              </Stack.Toolbar.Menu>
              <Stack.Toolbar.Menu inline>
                <Stack.Toolbar.MenuAction isOn={filterType === ItemFilter.Passkeys} onPress={() => setFilterType(ItemFilter.Passkeys)}>{t('common.passkeys')}</Stack.Toolbar.MenuAction>
                <Stack.Toolbar.MenuAction isOn={filterType === ItemFilter.Attachments} onPress={() => setFilterType(ItemFilter.Attachments)}>{t('common.attachments')}</Stack.Toolbar.MenuAction>
              </Stack.Toolbar.Menu>
            </Stack.Toolbar.Menu>
          )}
          {hasRail && (
            <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel={t('common.moreOptions')}>
              {(sortedItems.length > 0 || selection.isActive) && (
                <Stack.Toolbar.Menu inline>
                  <Stack.Toolbar.MenuAction icon="checkmark.circle" onPress={toggleSelectionMode}>{selection.isActive ? t('common.selection.disable') : t('common.selection.enable')}</Stack.Toolbar.MenuAction>
                </Stack.Toolbar.Menu>
              )}
              <Stack.Toolbar.Menu inline title={t('items.sort.title')}>
                {SORT_OPTIONS.map((option) => (
                  <Stack.Toolbar.MenuAction key={option.value} isOn={sortOrder === option.value} onPress={() => void changeSortOrder(option.value)}>{t(option.labelKey)}</Stack.Toolbar.MenuAction>
                ))}
              </Stack.Toolbar.Menu>
              {((canShareFolder && folder) || canEditFolder || canDeleteFolder) && (
                <Stack.Toolbar.Menu inline>
                  {canShareFolder && folder && <Stack.Toolbar.MenuAction icon="person.2" onPress={() => setPeopleFolder({ folder, isShared: isVirtualFolder })}>{t('common.share')}</Stack.Toolbar.MenuAction>}
                  {canEditFolder && <Stack.Toolbar.MenuAction icon="pencil" onPress={() => setShowEditFolderModal(true)}>{t('common.edit')}</Stack.Toolbar.MenuAction>}
                  {canDeleteFolder && <Stack.Toolbar.MenuAction icon="trash" destructive onPress={() => (isVirtualFolder ? deleteSharedFolder() : setShowDeleteFolderModal(true))}>{t('common.delete')}</Stack.Toolbar.MenuAction>}
                </Stack.Toolbar.Menu>
              )}
            </Stack.Toolbar.Menu>
          )}
          {/* In the rail, share, edit and delete sit in the ellipsis menu above to keep the rail short. */}
          {!hasRail && canShareFolder && folder && (
            <Stack.Toolbar.Button icon="person.2" onPress={() => setPeopleFolder({ folder, isShared: isVirtualFolder })}>{t('common.share')}</Stack.Toolbar.Button>
          )}
          {!hasRail && canEditFolder && (
            <Stack.Toolbar.Button icon="pencil" onPress={() => setShowEditFolderModal(true)}>{t('common.edit')}</Stack.Toolbar.Button>
          )}
          {!hasRail && canDeleteFolder && (
            <Stack.Toolbar.Button icon="trash" tintColor={colors.destructive} onPress={() => (isVirtualFolder ? deleteSharedFolder() : setShowDeleteFolderModal(true))}>{t('common.delete')}</Stack.Toolbar.Button>
          )}
        </ScreenToolbar>
      )}
      {/* Item list */}
      <FlatList
        ref={flatListRef}
        key={scrollSelected.listKey}
        data={isLoadingItems ? Array(4).fill(null) : sortedItems}
        keyExtractor={(itm, index) => itm ? scopedKey(itm.ManifestId, itm.Id) : `skeleton-${index}`}
        keyboardShouldPersistTaps='handled'
        keyboardDismissMode='on-drag'
        contentContainerStyle={[styles.contentContainer, selection.isActive && { paddingBottom: paddingBottom + SELECTION_BAR_SPACE }]}
        contentInsetAdjustmentBehavior="automatic"
        {...scrollSelected.listProps}
        maxToRenderPerBatch={14}
        windowSize={7}
        removeClippedSubviews={false}
        ListHeaderComponent={<View onLayout={scrollSelected.onListHeaderLayout}>{listHeader}</View>}
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
            <ItemCard
              item={itm}
              onItemDelete={onItemDelete}
              onItemDuplicate={onItemDuplicate}
              isHighlighted={scopedKey(itm.ManifestId, itm.Id) === highlightedItemKey}
              selectionMode={selection.isActive}
              isSelected={selection.isSelected(itm)}
              onToggleSelect={toggleItem}
              onSelectFromMenu={selectFromMenu}
            />
          )
        }
        ListEmptyComponent={renderEmptyComponent() as React.ReactElement}
      />

      {/* FAB with item type menu; the selection bar takes its place while selecting */}
      {selection.isActive ? (
        <ItemSelectionBar
          selection={selection.selection}
          visibleCount={sortedItems.length}
          folders={allFolders}
          personalManifestId={personalManifestId}
          currentFolder={folderRef}
          onSelectAll={selection.selectAll}
          onClose={exitSelection}
          onDone={async () => {
            // Reload first, so the selected rows stay marked until the list changes, in one step.
            await loadItems();
            exitSelection();
          }}
        />
      ) : (
        <AddItemFab onSelectType={handleAddItem} />
      )}

      {/* Filter menu overlay */}
      {renderFilterOverlay()}

      {/* List menu overlay */}
      <ListMenu
        visible={showSortMenu}
        selection={sortedItems.length > 0 || selection.isActive ? { isActive: selection.isActive, onToggle: toggleSelectionMode } : undefined}
        sortOrder={sortOrder}
        onSelect={changeSortOrder}
        actions={folderMenuActions}
        onClose={() => setShowSortMenu(false)}
        topOffset={Platform.OS === 'ios' ? menuTopOffset : undefined}
      />

      {/* Folder modals; a shared folder is renamed through its shared manifest, whose name an invitation has to fit */}
      <FolderModal
        isOpen={showEditFolderModal}
        onClose={() => setShowEditFolderModal(false)}
        onSave={isVirtualFolder ? handleEditSharedFolder : handleEditFolder}
        initialName={folder?.Name || ''}
        mode="edit"
        maxLength={isVirtualFolder ? MAX_SHARED_VAULT_NAME_LENGTH : undefined}
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
      {peopleFolder && (
        <SharedFolderAccessModal
          folder={peopleFolder.folder}
          isShared={peopleFolder.isShared}
          shared={shared}
          onMoved={(ref, movedIsShared) => {
            setPeopleFolder(open => (open ? { folder: { ...open.folder, Id: ref.Id, ManifestId: ref.ManifestId, ParentFolderId: null }, isShared: movedIsShared } : null));
            router.setParams({ manifestId: ref.ManifestId, id: ref.Id });
          }}
          onLeft={() => {
            setPeopleFolder(null);
            router.dismissTo('/(tabs)/items');
          }}
          onClose={() => setPeopleFolder(null)}
        />
      )}
    </ThemedContainer>
  );
}
