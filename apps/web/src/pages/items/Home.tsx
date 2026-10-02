import { scopedKey } from '@aliasvault/client/database/ItemRef';
import { CredentialSortOrder } from '@aliasvault/client/database/repositories/SettingsRepository';
import { canHaveSubfolders, getDescendantFolderIds, getFolderPath, isItemInFolder, isSharedFolder } from '@aliasvault/client/items/FolderUtils';
import { ItemFilter, applyTypeFilter, type ItemFilterType, parseItemFilterType } from '@aliasvault/client/items/ItemFilters';
import { multiManifestRendering } from '@aliasvault/client/sharing/MultiManifestRendering';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import DeleteFolderModal from '@/components/folders/DeleteFolderModal';
import FolderModal from '@/components/folders/FolderModal';
import FolderPill, { type FolderWithCount } from '@/components/items/FolderPill';
import ItemCard from '@/components/items/ItemCard';
import ItemFilterDropdown from '@/components/items/ItemFilterDropdown';
import { type ItemListEntry, toItemListEntry } from '@/components/items/ItemListEntry';
import ItemsTable from '@/components/items/ItemsTable';
import LoadingIndicator from '@/components/loading/LoadingIndicator';
import type { BreadcrumbItem } from '@/components/shared/Breadcrumb';
import FormLabel from '@/components/shared/FormLabel';
import PageContent from '@/components/shared/PageContent';
import PageHeader from '@/components/shared/PageHeader';
import RefreshButton from '@/components/shared/RefreshButton';
import Select from '@/components/shared/Select';
import type { SortDirection } from '@/components/shared/SortableTable';
import { useDb } from '@/context/DbContext';
import { useNotifications } from '@/context/NotificationContext';
import { useClickOutside } from '@/hooks/useClickOutside';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVaultMutate, VaultPushFailedError } from '@/hooks/useVaultMutate';
import { useVaultSync } from '@/hooks/useVaultSync';
import { folderRoute } from '@/utils/ItemRoute';
import { getLocalPreferenceJson, setLocalPreferenceJson } from '@/utils/LocalPreferences';
import { LocalPreferenceKeys } from '@/utils/StorageKeys';

import type { Folder, FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';
import type { Item } from '@aliasvault/models/vault';

/** How many items render per infinite scroll batch (180 makes up for 30 equal rows in full width desktop view) */
const BATCH_SIZE = 180;

/** Grid or table. */
type ViewMode = 'grid' | 'table';

/**
 * The items URL for a folder and filter. The filter is always in the query string so it survives navigation.
 * @param folder - the folder, or null for the root
 * @param filter - the active filter
 */
const buildItemsUrl = (folder: FolderRef | null, filter: ItemFilterType): string => `${folder ? folderRoute(folder) : '/items'}?filter=${filter}`;

/**
 * Sort entries by the table column.
 */
const applyTableSort = (entries: ItemListEntry[], column: string, direction: SortDirection): ItemListEntry[] => {
  const sign = direction === 'asc' ? 1 : -1;
  /**
   * Compare two strings, nulls first.
   */
  const byString = (a: string | null, b: string | null): number => (a ?? '').localeCompare(b ?? '') * sign;
  switch (column) {
    case 'Service': return [...entries].sort((a, b) => byString(a.service, b.service));
    case 'Username': return [...entries].sort((a, b) => byString(a.username, b.username));
    case 'Email': return [...entries].sort((a, b) => byString(a.email, b.email));
    default: return [...entries].sort((a, b) => (a.createdAt.getTime() - b.createdAt.getTime()) * (column === 'CreatedAt' ? sign : 1));
  }
};

/**
 * The vault dashboard showing all items.
 */
const ItemsHome: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { manifestId: manifestIdParam, folderId: folderIdParam } = useParams<{ manifestId?: string; folderId?: string }>();
  const [searchParams] = useSearchParams();
  const dbContext = useDb();
  const notifications = useNotifications();
  const { syncVault } = useVaultSync();
  const { executeVaultMutationAsync, executeVaultMutationInBackground } = useVaultMutate();
  usePageTitle('Home');

  const folderRef = useMemo((): FolderRef | null => (folderIdParam && manifestIdParam ? { Id: folderIdParam, ManifestId: manifestIdParam } : null), [folderIdParam, manifestIdParam]);
  const isInFolder = folderRef !== null;
  const filterType = parseItemFilterType(searchParams.get('filter'));

  const [isLoading, setIsLoading] = useState(true);
  const [items, setItems] = useState<ItemListEntry[]>([]);
  const [allFolders, setAllFolders] = useState<Folder[]>([]);
  const [recentlyDeletedCount, setRecentlyDeletedCount] = useState(0);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [showEditFolderModal, setShowEditFolderModal] = useState(false);
  const [showDeleteFolderModal, setShowDeleteFolderModal] = useState(false);
  const [showFolders, setShowFolders] = useState<boolean>(() => getLocalPreferenceJson<boolean>(LocalPreferenceKeys.ITEMS_SHOW_FOLDERS) ?? true);
  const [viewMode, setViewModeState] = useState<ViewMode>('grid');
  const [sortOrder, setSortOrderState] = useState<CredentialSortOrder>(CredentialSortOrder.NewestFirst);
  const [tableSortColumn, setTableSortColumn] = useState('CreatedAt');
  const [tableSortDirection, setTableSortDirection] = useState<SortDirection>('desc');
  const [visibleItemCount, setVisibleItemCount] = useState(BATCH_SIZE);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsDropdownRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  /**
   * Close the settings dropdown.
   */
  const closeSettingsPopup = useCallback((): void => setShowSettingsDropdown(false), []);
  useClickOutside([settingsButtonRef, settingsDropdownRef], closeSettingsPopup, showSettingsDropdown);

  /**
   * Table sort follows the sort order setting.
   */
  const syncTableSortWithSortOrder = useCallback((order: CredentialSortOrder): void => {
    switch (order) {
      case CredentialSortOrder.NewestFirst:
        setTableSortColumn('CreatedAt');
        setTableSortDirection('desc');
        break;
      case CredentialSortOrder.Alphabetical:
        setTableSortColumn('Service');
        setTableSortDirection('asc');
        break;
      default:
        setTableSortColumn('CreatedAt');
        setTableSortDirection('asc');
    }
  }, []);

  /**
   * Load the items, folders and settings from the vault.
   */
  const loadItems = useCallback((): void => {
    const client = dbContext.sqliteClient;
    if (!client) {
      return;
    }
    setIsLoading(true);
    setVisibleItemCount(BATCH_SIZE);
    try {
      const vaultItems: Item[] = client.items.getAll();
      if (vaultItems.length === 0 && !folderRef && client.settings.getSetting('TutorialDone', 'False').toLowerCase() !== 'true') {
        navigate('/welcome');
        return;
      }
      setItems(vaultItems.map(toItemListEntry));
      setAllFolders(client.folders.getAll());
      setRecentlyDeletedCount(client.items.getRecentlyDeletedCount());
      const mode = client.settings.getSetting('CredentialsViewMode', 'grid');
      setViewModeState(mode === 'table' ? 'table' : 'grid');
      const order = client.settings.getCredentialsSortOrder();
      setSortOrderState(order);
      syncTableSortWithSortOrder(order);
    } catch (error) {
      console.error('Failed to load items:', error);
      notifications.addErrorMessage(t('items.home.failedToLoadItemsMessage'), true);
    } finally {
      setIsLoading(false);
    }
  }, [dbContext.sqliteClient, folderRef, navigate, notifications, syncTableSortWithSortOrder, t]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  /**
   * Persist the view mode in the vault settings.
   */
  const setViewMode = (mode: ViewMode): void => {
    setViewModeState(mode);
    const client = dbContext.sqliteClient;
    if (client) {
      void executeVaultMutationInBackground(async () => {
        client.settings.updateSetting('CredentialsViewMode', mode);
      });
    }
  };

  /**
   * Persist the sort order in the vault settings.
   */
  const setSortOrder = (order: CredentialSortOrder): void => {
    setSortOrderState(order);
    syncTableSortWithSortOrder(order);
    setVisibleItemCount(BATCH_SIZE);
    const client = dbContext.sqliteClient;
    if (client) {
      void executeVaultMutationInBackground(async () => {
        client.settings.setCredentialsSortOrder(order);
      });
    }
  };

  const currentFolder = useMemo(() => folderRef ? allFolders.find(f => f.Id === folderRef.Id && f.ManifestId === folderRef.ManifestId) ?? null : null, [allFolders, folderRef]);
  const currentFolderName = currentFolder?.Name ?? '';
  // A virtual folder (a shared manifest) is not editable or deletable here.
  const currentFolderIsVirtual = currentFolder !== null && multiManifestRendering.isVirtualFolder(currentFolder);

  /**
   * Items after the folder and type filters.
   */
  const allFilteredAndSortedItems = useMemo((): ItemListEntry[] => {
    let filtered = items;
    if (folderRef) {
      filtered = filtered.filter(x => isItemInFolder(x.item, folderRef));
    } else if (showFolders) {
      filtered = filtered.filter(x => x.folderId === null);
    }

    const filteredItems = new Set(applyTypeFilter(filtered.map(e => e.item), filterType).map(i => scopedKey(i.ManifestId, i.Id)));
    filtered = filtered.filter(e => filteredItems.has(scopedKey(e.manifestId, e.id)));

    if (viewMode === 'table') {
      return applyTableSort(filtered, tableSortColumn, tableSortDirection);
    }
    switch (sortOrder) {
      case CredentialSortOrder.NewestFirst: return [...filtered].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      case CredentialSortOrder.Alphabetical: return [...filtered].sort((a, b) => (a.service ?? '').localeCompare(b.service ?? ''));
      default: return [...filtered].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    }
  }, [items, folderRef, showFolders, filterType, viewMode, tableSortColumn, tableSortDirection, sortOrder]);

  const totalFilteredItems = allFilteredAndSortedItems.length;
  const hasMoreItems = visibleItemCount < totalFilteredItems;
  const filteredAndSortedItems = allFilteredAndSortedItems.slice(0, visibleItemCount);
  const hasItemsInFoldersOnly = items.length > 0 && items.every(x => x.folderId !== null);

  /**
   * Folders at the current level with their (recursive) filtered item counts.
   */
  const currentLevelFolders = useMemo((): FolderWithCount[] => {
    const personalManifestId = dbContext.sqliteClient?.getPersonalManifestId() ?? null;
    const typeFiltered = new Set(applyTypeFilter(items.map(e => e.item), filterType).map(i => scopedKey(i.ManifestId, i.Id)));
    // At the root the top-level folders of every manifest show; inside a folder its children, which share its manifest.
    return allFolders
      .filter(f => folderRef ? f.ParentFolderId === folderRef.Id && f.ManifestId === folderRef.ManifestId : (f.ParentFolderId ?? null) === null)
      .map(f => {
        const folderIds = new Set([f.Id, ...getDescendantFolderIds(f, allFolders)]);
        return {
          id: f.Id,
          manifestId: f.ManifestId,
          name: f.Name,
          parentFolderId: f.ParentFolderId ?? null,
          itemCount: items.filter(e => e.manifestId === f.ManifestId && e.folderId !== null && folderIds.has(e.folderId) && typeFiltered.has(scopedKey(e.manifestId, e.id))).length,
          isShared: isSharedFolder(f, personalManifestId),
        };
      });
  }, [allFolders, folderRef, items, filterType, dbContext.sqliteClient]);

  const canCreateSubfolder = !folderRef || (allFolders.length > 0 && canHaveSubfolders(folderRef, allFolders));

  /**
   * Items in the current folder tree, for the delete folder modal.
   */
  const currentFolderItemCount = useMemo((): number => {
    if (!folderRef) {
      return filteredAndSortedItems.length;
    }
    const folderIds = new Set([folderRef.Id, ...getDescendantFolderIds(folderRef, allFolders)]);
    return items.filter(e => e.manifestId === folderRef.ManifestId && e.folderId !== null && folderIds.has(e.folderId)).length;
  }, [folderRef, allFolders, items, filteredAndSortedItems.length]);

  /**
   * Breadcrumbs for the folder hierarchy (the last folder is the current page).
   */
  const breadcrumbItems = useMemo((): BreadcrumbItem[] => {
    if (!folderRef) {
      return [];
    }
    const names = getFolderPath(folderRef, allFolders);
    const manifestFolders = allFolders.filter(f => f.ManifestId === folderRef.ManifestId);
    const path: BreadcrumbItem[] = [];
    let current: Folder | undefined = manifestFolders.find(f => f.Id === folderRef.Id);
    const chain: Folder[] = [];
    while (current) {
      chain.unshift(current);
      const parentId: string | null | undefined = current.ParentFolderId;
      current = parentId ? manifestFolders.find(f => f.Id === parentId) : undefined;
    }
    chain.forEach((folder, index) => {
      path.push({ displayName: names[index] ?? folder.Name, url: index === chain.length - 1 ? undefined : buildItemsUrl(folder, filterType) });
    });
    return path;
  }, [folderRef, allFolders, filterType]);

  /**
   * The title for the active filter and folder.
   */
  const getFilterTitle = (): string => {
    switch (filterType) {
      case ItemFilter.Passkeys: return t('common.passkeys');
      case ItemFilter.Attachments: return t('common.attachments');
      case ItemFilter.Totp: return t('items.filters.totp');
      case ItemFilter.Login: return t('itemTypes.login.title');
      case ItemFilter.Alias: return t('itemTypes.alias.title');
      case ItemFilter.CreditCard: return t('itemTypes.creditCard.title');
      case ItemFilter.Note: return t('itemTypes.secureNote');
      default:
        return isInFolder && currentFolderName ? currentFolderName : t('navigation.vault');
    }
  };

  /**
   * The class of the add folder button: dashed when there are no folders yet.
   */
  const getAddFolderButtonClass = (): string => allFolders.length > 0
    ? 'inline-flex items-center gap-1.5 px-5 py-2.5 text-sm rounded-lg transition-colors focus:outline-none text-gray-500 dark:text-gray-400 hover:text-orange-600 dark:hover:text-orange-400 hover:bg-gray-100 dark:hover:bg-gray-700/50'
    : 'inline-flex items-center gap-1.5 px-5 py-2.5 text-sm rounded-lg transition-colors focus:outline-none text-gray-400 dark:text-gray-500 border border-dashed border-gray-300 dark:border-gray-600 hover:border-orange-400 dark:hover:border-orange-500 hover:text-orange-600 dark:hover:text-orange-400';

  /**
   * Pick a filter.
   */
  const setFilter = (filter: ItemFilterType): void => {
    setVisibleItemCount(BATCH_SIZE);
    navigate(buildItemsUrl(folderRef, filter), { replace: true });
  };

  /**
   * Toggle folder grouping.
   */
  const toggleShowFolders = (): void => {
    const next = !showFolders;
    setShowFolders(next);
    setVisibleItemCount(BATCH_SIZE);
    setLocalPreferenceJson(LocalPreferenceKeys.ITEMS_SHOW_FOLDERS, next);
  };

  /**
   * Table header sort.
   */
  const handleTableSortChanged = (column: string, direction: SortDirection): void => {
    setTableSortColumn(column);
    setTableSortDirection(direction);
    setVisibleItemCount(BATCH_SIZE);
  };

  /**
   * Pull the latest vault from the server, then reload the list.
   */
  const refreshVault = async (): Promise<void> => {
    await syncVault({ onSuccess: loadItems });
  };

  /**
   * Infinite scroll: load the next batch when the sentinel comes into view.
   */
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMoreItems || isLoading) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting) && !isLoadingMore) {
        setIsLoadingMore(true);
        setTimeout(() => {
          setVisibleItemCount(count => count + BATCH_SIZE);
          setIsLoadingMore(false);
        }, 300);
      }
    });
    observer.observe(sentinel);
    return (): void => observer.disconnect();
  }, [hasMoreItems, isLoading, isLoadingMore]);

  /**
   * Create a folder at the current level.
   */
  const createFolder = async (name: string): Promise<void> => {
    const client = dbContext.sqliteClient;
    if (!client) {
      return;
    }
    try {
      await executeVaultMutationAsync(async () => {
        await client.folders.create(name, folderRef);
      });
      setAllFolders(client.folders.getAll());
    } catch (error) {
      console.error('Failed to create folder:', error);
      // Failed push (e.g. server not reachable).
      if (!(error instanceof VaultPushFailedError)) {
        notifications.addErrorMessage(t('items.home.failedToCreateFolder'), true);
      }
    }
  };

  /**
   * Rename the current folder.
   */
  const editFolder = async (name: string): Promise<void> => {
    const client = dbContext.sqliteClient;
    if (!client || !folderRef) {
      return;
    }
    try {
      await executeVaultMutationAsync(async () => {
        await client.folders.update(folderRef, name);
      });
      setAllFolders(client.folders.getAll());
    } catch (error) {
      console.error('Failed to rename folder:', error);
      if (!(error instanceof VaultPushFailedError)) {
        notifications.addErrorMessage(t('common.errorGeneric'), true);
      }
    }
  };

  /**
   * Delete the current folder, keeping or trashing its contents, and go to its parent.
   */
  const deleteFolder = async (withContents: boolean): Promise<void> => {
    const client = dbContext.sqliteClient;
    if (!client || !folderRef) {
      return;
    }
    const parentFolderId = currentFolder?.ParentFolderId ?? null;
    try {
      await executeVaultMutationAsync(async () => {
        if (withContents) {
          await client.folders.deleteWithContents(folderRef);
        } else {
          await client.folders.delete(folderRef);
        }
      });
      navigate(buildItemsUrl(parentFolderId ? { Id: parentFolderId, ManifestId: folderRef.ManifestId } : null, filterType));
    } catch (error) {
      console.error('Failed to delete folder:', error);
      if (!(error instanceof VaultPushFailedError)) {
        notifications.addErrorMessage(t('items.home.failedToDeleteFolder'), true);
      }
    }
  };

  return (
    <>
      <PageHeader
        breadcrumbItems={breadcrumbItems}
        title={getFilterTitle()}
        description={t('items.home.pageDescription')}
        titleActions={(
          <ItemFilterDropdown
            title={getFilterTitle()}
            count={totalFilteredItems}
            titleFolder={filterType === ItemFilter.All && currentFolder && currentFolderName ? { isShared: isSharedFolder(currentFolder, dbContext.sqliteClient?.getPersonalManifestId()) } : undefined}
            activeFilter={filterType}
            recentlyDeletedCount={recentlyDeletedCount}
            showFoldersToggle={!isInFolder}
            showFolders={showFolders}
            onSelectFilter={setFilter}
            onSelectRecentlyDeleted={() => navigate('/items/recently-deleted')}
            onToggleShowFolders={toggleShowFolders}
            titleActions={isInFolder && !currentFolderIsVirtual ? (
              <>
                <button onClick={() => setShowEditFolderModal(true)} title={t('items.folders.editFolder')} className="p-1.5 text-gray-400 hover:text-orange-500 dark:text-gray-500 dark:hover:text-orange-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button onClick={() => setShowDeleteFolderModal(true)} title={t('items.folders.deleteFolder')} className="p-1.5 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </>
            ) : undefined} />
        )}
        customActions={(
          <>
            <div className="relative">
              <button ref={settingsButtonRef} onClick={() => setShowSettingsDropdown(!showSettingsDropdown)} id="settingsButton" className="p-2 text-gray-500 rounded-lg hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-700">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                  <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd"></path>
                </svg>
              </button>

              {showSettingsDropdown && (
                <div ref={settingsDropdownRef} id="settingsDropdown" className="absolute right-0 z-10 mt-2 min-w-[220px] origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none dark:bg-gray-700">
                  <div className="p-4">
                    <div className="mb-4">
                      <FormLabel>{t('items.home.viewModeLabel')}</FormLabel>
                      <Select value={viewMode} onChange={(e) => {
                        setViewMode(e.target.value as ViewMode); closeSettingsPopup(); 
                      }}>
                        <option value="grid">{t('items.home.gridViewOption')}</option>
                        <option value="table">{t('items.home.tableViewOption')}</option>
                      </Select>
                    </div>
                    <div className="mb-4">
                      <FormLabel>{t('items.home.sortOrderLabel')}</FormLabel>
                      <Select value={sortOrder} onChange={(e) => {
                        setSortOrder(e.target.value as CredentialSortOrder); closeSettingsPopup(); 
                      }}>
                        <option value={CredentialSortOrder.OldestFirst}>{t('items.sort.oldestFirst')}</option>
                        <option value={CredentialSortOrder.NewestFirst}>{t('items.sort.newestFirst')}</option>
                        <option value={CredentialSortOrder.Alphabetical}>{t('items.home.alphabeticalOption')}</option>
                      </Select>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <RefreshButton onClick={refreshVault} buttonText={t('common.refresh')} />
          </>
        )} />

      {isLoading ? (
        <LoadingIndicator />
      ) : (
        <PageContent className="px-4 mb-4">
          {filterType !== ItemFilter.All && (
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className="text-sm text-gray-500 dark:text-gray-400">{t('items.home.filteringBy')}</span>
              <button onClick={() => setFilter(ItemFilter.All)} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-orange-100 dark:bg-orange-900/30 hover:bg-orange-200 dark:hover:bg-orange-900/50 text-orange-700 dark:text-orange-300 rounded-lg transition-colors">
                <span>{getFilterTitle()}</span>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}

          {showFolders && (
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {currentLevelFolders.map(folder => (
                <FolderPill key={scopedKey(folder.manifestId, folder.id)} folder={folder} onClick={() => {
                  setVisibleItemCount(BATCH_SIZE); navigate(buildItemsUrl({ Id: folder.id, ManifestId: folder.manifestId }, filterType)); 
                }} />
              ))}
              {canCreateSubfolder && (
                <button onClick={() => setShowFolderModal(true)} className={getAddFolderButtonClass()}>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <svg className="w-3.5 h-3.5 -ml-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  {currentLevelFolders.length === 0 && <span>{t('items.folders.newFolder')}</span>}
                </button>
              )}
            </div>
          )}

          {viewMode === 'table' ? (
            <ItemsTable entries={filteredAndSortedItems} sortColumn={tableSortColumn} sortDirection={tableSortDirection} onTableSortChanged={handleTableSortChanged} onMutated={loadItems} />
          ) : (
            <div className="grid gap-4 md:grid-cols-4 xl:grid-cols-6">
              {items.length === 0 && !isInFolder ? (
                <div className="credential-card col-span-full p-4 space-y-2 bg-amber-50 border border-primary-500 rounded-lg shadow-sm dark:border-primary-700 dark:bg-gray-800">
                  <div className="px-4 py-6 text-gray-700 dark:text-gray-200 rounded text-center flex flex-col items-center">
                    <p className="mb-2 text-lg font-semibold text-primary-700 dark:text-primary-400">{t('items.home.noItemsTitle')}</p>
                    <div className="max-w-md mx-auto">
                      <div className="mb-6">
                        <p className="text-sm mb-2">{t('items.home.createFirstItemText')} <span className="hidden md:inline">{t('items.home.newAliasButtonText')}</span><span className="md:hidden">{t('items.home.newAliasButtonTextMobile')}</span> {t('items.home.buttonLocationText')}</p>
                      </div>
                      <div className="flex items-center my-6">
                        <div className="flex-1 h-px bg-gray-300 dark:bg-gray-600"></div>
                        <span className="px-4 text-sm text-gray-500 dark:text-gray-400">{t('common.or')}</span>
                        <div className="flex-1 h-px bg-gray-300 dark:bg-gray-600"></div>
                      </div>
                      <div>
                        <p className="text-sm mb-2">{t('items.home.importItemsText')}</p>
                        <Link to="/settings/import-export" className="inline-block text-sm px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors dark:bg-primary-700 dark:hover:bg-primary-600">
                          {t('items.home.importButtonText')}
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              ) : filteredAndSortedItems.length === 0 && (
                <div className="credential-card col-span-full p-4 space-y-2 bg-amber-50 border border-primary-500 rounded-lg shadow-sm dark:border-primary-700 dark:bg-gray-800">
                  <div className="px-4 py-6 text-gray-700 dark:text-gray-200 rounded text-center">
                    {filterType !== ItemFilter.All ? (
                      <p>{t('items.noMatchingItems')}</p>
                    ) : isInFolder ? (
                      <p>{t('items.home.emptyFolderMessage')}</p>
                    ) : hasItemsInFoldersOnly ? (
                      <p>{t('items.allItemsInFoldersClick')}</p>
                    ) : (
                      <p>{t('items.noMatchingItems')}</p>
                    )}
                  </div>
                </div>
              )}
              {filteredAndSortedItems.map(entry => (
                <ItemCard key={scopedKey(entry.manifestId, entry.id)} entry={entry} onMutated={loadItems} />
              ))}
            </div>
          )}

          {hasMoreItems && (
            <div ref={sentinelRef} className="flex justify-center py-4 min-h-[40px]">
              {isLoadingMore && (
                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>{t('items.home.loadingMore')}</span>
                </div>
              )}
            </div>
          )}
        </PageContent>
      )}

      <FolderModal isOpen={showFolderModal} mode="create" onClose={() => setShowFolderModal(false)} onSave={createFolder} />
      <FolderModal isOpen={showEditFolderModal} mode="edit" initialName={currentFolderName} onClose={() => setShowEditFolderModal(false)} onSave={editFolder} />
      <DeleteFolderModal
        isOpen={showDeleteFolderModal}
        folderName={currentFolderName}
        itemCount={currentFolderItemCount}
        onClose={() => setShowDeleteFolderModal(false)}
        onDeleteFolderOnly={() => deleteFolder(false)}
        onDeleteFolderAndContents={() => deleteFolder(true)} />
    </>
  );
};

export default ItemsHome;
