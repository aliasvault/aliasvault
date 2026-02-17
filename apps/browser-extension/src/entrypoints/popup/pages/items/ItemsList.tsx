import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import DeleteFolderModal from '@/entrypoints/popup/components/Folders/DeleteFolderModal';
import FolderModal from '@/entrypoints/popup/components/Folders/FolderModal';
import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import FolderPill from '@/entrypoints/popup/components/Items/FolderPill';
import ItemCard from '@/entrypoints/popup/components/Items/ItemCard';
import { ITEM_TYPE_OPTIONS } from '@/entrypoints/popup/components/Items/ItemTypeSelector';
import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import ReloadButton from '@/entrypoints/popup/components/ReloadButton';
import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useVaultMutate } from '@/entrypoints/popup/hooks/useVaultMutate';
import { useVaultSync } from '@/entrypoints/popup/hooks/useVaultSync';
import { PopoutUtility } from '@/entrypoints/popup/utils/PopoutUtility';

import type { CredentialSortOrder } from '@/utils/db/repositories/SettingsRepository';
import type { Item, ItemType } from '@/utils/dist/core/models/vault';
import { ItemTypes } from '@/utils/dist/core/models/vault';
import { LocalPreferencesService } from '@/utils/LocalPreferencesService';

import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';

/**
 * Filter types for the items list.
 * - 'all': Show all items
 * - 'passkeys': Show only items with passkeys
 * - 'attachments': Show only items with attachments
 * - 'totp': Show only items with 2FA codes
 * - ItemType values: Filter by specific item type (Login, Alias, CreditCard, Note)
 */
type FilterType = 'all' | 'passkeys' | 'attachments' | 'totp' | ItemType;

const FILTER_STORAGE_KEY = 'items-filter';
const FILTER_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Sort order options with their translation keys
 */
const SORT_OPTIONS: { value: CredentialSortOrder; labelKey: string }[] = [
  { value: 'OldestFirst', labelKey: 'items.sort.oldestFirst' },
  { value: 'NewestFirst', labelKey: 'items.sort.newestFirst' },
  { value: 'Alphabetical', labelKey: 'items.sort.alphabetical' },
];

/**
 * Get stored filter from localStorage if not expired
 */
const getStoredFilter = (): FilterType => {
  try {
    const stored = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!stored) {
      return 'all';
    }

    const { filter, timestamp } = JSON.parse(stored);
    const now = Date.now();

    // Check if expired (5 minutes)
    if (now - timestamp > FILTER_EXPIRY_MS) {
      localStorage.removeItem(FILTER_STORAGE_KEY);
      return 'all';
    }

    return filter as FilterType;
  } catch {
    return 'all';
  }
};

/**
 * Store filter in localStorage with timestamp
 */
const storeFilter = (filter: FilterType): void => {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({
      filter,
      timestamp: Date.now()
    }));
  } catch {
    // Ignore storage errors
  }
};

/**
 * Check if a filter is an item type filter
 */
const isItemTypeFilter = (filter: FilterType): filter is ItemType => {
  return Object.values(ItemTypes).includes(filter as ItemType);
};

/**
 * Represents a folder with item count
 */
type FolderWithCount = {
  id: string;
  name: string;
  itemCount: number;
};

/**
 * Items list page with folder support.
 */
const ItemsList: React.FC = () => {
  const { t } = useTranslation();
  const { folderId: folderIdParam } = useParams<{ folderId?: string }>();
  const location = useLocation();
  const dbContext = useDb();
  const app = useApp();
  const navigate = useNavigate();
  const { syncVault } = useVaultSync();
  const { executeVaultMutationAsync } = useVaultMutate();
  const { setHeaderButtons } = useHeaderButtons();
  const [items, setItems] = useState<Item[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<FilterType>(getStoredFilter());
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [showDeleteFolderModal, setShowDeleteFolderModal] = useState(false);
  const [showEditFolderModal, setShowEditFolderModal] = useState(false);
  const [recentlyDeletedCount, setRecentlyDeletedCount] = useState(0);
  const [folderRefreshKey, setFolderRefreshKey] = useState(0);
  const [sortOrder, setSortOrder] = useState<CredentialSortOrder>('OldestFirst');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showFolders, setShowFolders] = useState(true);
  const { setIsInitialLoading } = useLoading();

  // Load showFolders preference from storage on mount
  useEffect(() => {
    LocalPreferencesService.getShowFolders().then(setShowFolders);
  }, []);

  // Derive current folder from URL params
  const currentFolderId = folderIdParam ?? null;

  // Get current folder name from database
  const currentFolderName = useMemo(() => {
    // folderRefreshKey is included in deps to force re-computation when folder is renamed
    void folderRefreshKey;
    if (!currentFolderId || !dbContext?.sqliteClient) {
      return null;
    }
    const folders = dbContext.sqliteClient.folders.getAll();
    const folder = folders.find((f: { Id: string; Name: string }) => f.Id === currentFolderId);
    return folder?.Name ?? null;
  }, [currentFolderId, dbContext?.sqliteClient, folderRefreshKey]);

  /**
   * Loading state with minimum duration for more fluid UX.
   */
  const [isLoading, setIsLoading] = useMinDurationLoading(true, 100);

  /**
   * Reset search and filter when navigating via the vault tab (with resetFilters state).
   */
  useEffect(() => {
    const state = location.state as { resetFilters?: boolean } | null;
    if (state?.resetFilters) {
      setSearchTerm('');
      setFilterType('all');
      localStorage.removeItem(FILTER_STORAGE_KEY);
      // Clear the state to prevent re-triggering on subsequent renders
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  /**
   * Handle add new item.
   * Navigate to add item page, pre-selecting the item type if filtering by type.
   * Also pre-selects the current folder if we're inside a folder.
   */
  const handleAddItem = useCallback(() : void => {
    const params = new URLSearchParams();

    // If filtering by an item type, pre-select that type for the new item
    if (isItemTypeFilter(filterType)) {
      params.set('type', filterType);
    }

    // Pre-select the current folder if we're inside a folder
    if (currentFolderId) {
      params.set('folderId', currentFolderId);
    }

    const queryString = params.toString();
    navigate(queryString ? `/items/add?${queryString}` : '/items/add');
  }, [navigate, filterType, currentFolderId]);

  /**
   * Handle add new folder.
   */
  const handleAddFolder = useCallback(() : void => {
    setShowFolderModal(true);
  }, []);

  /**
   * Handle save folder.
   */
  const handleSaveFolder = useCallback(async (folderName: string) : Promise<void> => {
    if (!dbContext?.sqliteClient) {
      console.error('[FOLDER DEBUG] No sqliteClient available');
      return;
    }

    await executeVaultMutationAsync(async () => {
      await dbContext.sqliteClient!.folders.create(folderName, currentFolderId);
    });

    // Refresh items to show the new folder
    const results = dbContext.sqliteClient!.items.getAll();
    setItems(results);
  }, [dbContext, currentFolderId, executeVaultMutationAsync]);

  /**
   * Handle delete folder (keep items, move them to root).
   */
  const handleDeleteFolderOnly = useCallback(async () : Promise<void> => {
    if (!dbContext?.sqliteClient || !currentFolderId) {
      return;
    }

    await executeVaultMutationAsync(async () => {
      await dbContext.sqliteClient!.folders.delete(currentFolderId);
    });

    // Refresh items list to reflect changes
    const results = dbContext.sqliteClient!.items.getAll();
    setItems(results);
    const deletedCount = dbContext.sqliteClient!.items.getRecentlyDeletedCount();
    setRecentlyDeletedCount(deletedCount);

    // Navigate back to root
    navigate('/items');
  }, [dbContext, currentFolderId, executeVaultMutationAsync, navigate]);

  /**
   * Handle delete folder and all its contents.
   */
  const handleDeleteFolderAndContents = useCallback(async () : Promise<void> => {
    if (!dbContext?.sqliteClient || !currentFolderId) {
      return;
    }

    await executeVaultMutationAsync(async () => {
      await dbContext.sqliteClient!.folders.deleteWithContents(currentFolderId);
    });

    // Refresh items list to reflect changes
    const results = dbContext.sqliteClient!.items.getAll();
    setItems(results);
    const deletedCount = dbContext.sqliteClient!.items.getRecentlyDeletedCount();
    setRecentlyDeletedCount(deletedCount);

    // Navigate back to root
    navigate('/items');
  }, [dbContext, currentFolderId, executeVaultMutationAsync, navigate]);

  /**
   * Handle edit/rename folder.
   */
  const handleEditFolder = useCallback(async (newName: string) : Promise<void> => {
    if (!dbContext?.sqliteClient || !currentFolderId) {
      return;
    }

    await executeVaultMutationAsync(async () => {
      await dbContext.sqliteClient!.folders.update(currentFolderId, newName);
    });

    // Trigger re-computation of currentFolderName
    setFolderRefreshKey(prev => prev + 1);

    // Close modal
    setShowEditFolderModal(false);
  }, [dbContext, currentFolderId, executeVaultMutationAsync]);

  /**
   * Retrieve latest vault and refresh the items list.
   */
  const onRefresh = useCallback(async () : Promise<void> => {
    if (!dbContext?.sqliteClient) {
      return;
    }

    try {
      // Sync vault and load items
      await syncVault({
        /**
         * On success.
         */
        onSuccess: async (_hasNewVault) => {
          // Items list is refreshed automatically when the (new) sqlite client is available via useEffect hook below.
        },
        /**
         * On offline.
         */
        onOffline: () => {
          // Continue with local vault in offline mode.
        },
        /**
         * On error.
         */
        onError: async (error) => {
          console.error('Error syncing vault:', error);
        },
      });
    } catch (err) {
      console.error('Error refreshing items:', err);
      await app.logout('Error while syncing vault, please re-authenticate.');
    }
  }, [dbContext, app, syncVault]);

  /**
   * Get latest vault from server and refresh the items list.
   */
  const syncVaultAndRefresh = useCallback(async () : Promise<void> => {
    setIsLoading(true);
    await onRefresh();
    setIsLoading(false);
  }, [onRefresh, setIsLoading]);

  // Set header buttons on mount and clear on unmount
  useEffect((): (() => void) => {
    const headerButtonsJSX = (
      <div className="flex items-center gap-2">
        {!PopoutUtility.isPopup() && (
          <HeaderButton
            onClick={() => PopoutUtility.openInNewPopup()}
            title={t('common.openInNewWindow')}
            iconType={HeaderIconType.EXPAND}
          />
        )}
        <HeaderButton
          onClick={handleAddItem}
          title={t('items.addNewItem')}
          iconType={HeaderIconType.PLUS}
        />
      </div>
    );

    setHeaderButtons(headerButtonsJSX);
    return () => setHeaderButtons(null);
  }, [setHeaderButtons, handleAddItem, t]);

  /**
   * Load items list on mount and on sqlite client change.
   */
  useEffect(() => {
    /**
     * Refresh items list when a (new) sqlite client is available.
     */
    const refreshItems = async () : Promise<void> => {
      if (dbContext?.sqliteClient) {
        setIsLoading(true);
        const results = dbContext.sqliteClient?.items.getAll() ?? [];
        setItems(results);
        // Also get recently deleted count
        const deletedCount = dbContext.sqliteClient?.items.getRecentlyDeletedCount() ?? 0;
        setRecentlyDeletedCount(deletedCount);
        // Load sort order from settings
        const savedSortOrder = dbContext.sqliteClient?.settings.getCredentialsSortOrder() ?? 'OldestFirst';
        setSortOrder(savedSortOrder);
        setIsLoading(false);
        setIsInitialLoading(false);
      }
    };

    refreshItems();
  }, [dbContext?.sqliteClient, setIsLoading, setIsInitialLoading]);

  /**
   * Get the title based on the active filter and current folder
   */
  const getFilterTitle = () : string => {
    if (currentFolderId && currentFolderName) {
      return currentFolderName;
    }

    switch (filterType) {
      case 'passkeys':
        return t('items.filters.passkeys');
      case 'attachments':
        return t('common.attachments');
      case 'totp':
        return t('items.filters.totp');
      case 'all':
        return t('items.title');
      default:
        // Check if it's an item type filter
        if (isItemTypeFilter(filterType)) {
          const itemTypeOption = ITEM_TYPE_OPTIONS.find(opt => opt.type === filterType);
          if (itemTypeOption) {
            return t(itemTypeOption.titleKey);
          }
        }
        return t('items.title');
    }
  };

  /**
   * Navigate into a folder via URL
   */
  const handleFolderClick = useCallback((folderId: string, _folderName: string) => {
    setSearchTerm(''); // Clear search when entering folder
    navigate(`/items/folder/${folderId}`);
  }, [navigate]);

  /**
   * Get folders with item counts (only for root level when not searching)
   */
  const getFoldersWithCounts = (): FolderWithCount[] => {
    if (currentFolderId || searchTerm) {
      return [];
    }

    if (!dbContext?.sqliteClient) {
      return [];
    }

    // Get all folders directly from the database
    const allFolders = dbContext.sqliteClient.folders.getAll();

    // Count items per folder
    const folderCounts = new Map<string, number>();
    items.forEach((item: Item) => {
      if (item.FolderId) {
        folderCounts.set(item.FolderId, (folderCounts.get(item.FolderId) || 0) + 1);
      }
    });

    // Build result with counts
    const result = allFolders.map((folder: { Id: string; Name: string }) => ({
      id: folder.Id,
      name: folder.Name,
      itemCount: folderCounts.get(folder.Id) || 0
    })).sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));

    return result;
  };

  /**
   * Filter items based on current view (folder, search, filter type)
   */
  const filteredItems = items.filter((item: Item) => {
    // Filter by current folder (if in folder view)
    if (currentFolderId !== null) {
      if (item.FolderId !== currentFolderId) {
        return false;
      }
    } else if (!searchTerm && showFolders) {
      /*
       * When showing folders (checkbox ON): only show root items (exclude items in folders)
       * When not showing folders (checkbox OFF): show all items flat
       */
      if (item.FolderId) {
        return false;
      }
    }

    // Apply type filter
    let passesTypeFilter = true;
    if (filterType === 'passkeys') {
      passesTypeFilter = item.HasPasskey === true;
    } else if (filterType === 'attachments') {
      passesTypeFilter = item.HasAttachment === true;
    } else if (filterType === 'totp') {
      passesTypeFilter = item.HasTotp === true;
    } else if (isItemTypeFilter(filterType)) {
      // Filter by item type (Login, Alias, CreditCard, Note)
      passesTypeFilter = item.ItemType === filterType;
    }

    if (!passesTypeFilter) {
      return false;
    }

    // Apply search filter
    const searchLower = searchTerm.toLowerCase().trim();
    if (!searchLower) {
      return true;
    }

    // Search in item name and fields
    const itemName = item.Name?.toLowerCase() || '';
    if (itemName.includes(searchLower)) {
      return true;
    }

    // Search in field values
    const fieldMatches = item.Fields?.some(field => {
      const value = Array.isArray(field.Value)
        ? field.Value.join(' ').toLowerCase()
        : (field.Value || '').toLowerCase();
      return value.includes(searchLower) || field.Label.toLowerCase().includes(searchLower);
    });

    if (fieldMatches) {
      return true;
    }

    return false;
  });

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

  const folders = getFoldersWithCounts();

  /**
   * Check if all items are in folders (no items at root level but items exist in folders).
   * This is used to show a helpful message when the user has imported credentials that were all in folders.
   */
  const hasItemsInFoldersOnly = items.length > 0 && items.every((item: Item) => item.FolderId !== null);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-8">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center gap-2 mb-4">
        <div className="relative min-w-0 flex-1 flex items-center gap-2">
          <button
            onClick={() => setShowFilterMenu(!showFilterMenu)}
            className="flex items-center gap-1 text-gray-900 dark:text-white text-xl hover:text-gray-700 dark:hover:text-gray-300 focus:outline-none min-w-0"
          >
            <h2 className="flex items-baseline gap-1.5 min-w-0 overflow-hidden">
              <span className="truncate">{getFilterTitle()}</span>
              <span className="text-sm text-gray-500 dark:text-gray-400 shrink-0">
                ({filteredItems.length})
              </span>
            </h2>
            <svg
              className="w-4 h-4 mt-1 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {/* Edit and Delete buttons when inside a folder */}
          {currentFolderId && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setShowEditFolderModal(true)}
                title={t('items.editFolder')}
                className="p-1.5 text-gray-400 hover:text-orange-500 dark:text-gray-500 dark:hover:text-orange-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                onClick={() => setShowDeleteFolderModal(true)}
                title={t('items.deleteFolder')}
                className="p-1.5 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          )}
          {showFilterMenu && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => {
                  setShowFilterMenu(false);
                }}
              />
              <div className="absolute left-0 top-full mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl ring-1 ring-black/5 dark:ring-white/10 z-20">
                <div className="py-1">
                  {/* All items filter with show folders toggle (only show toggle on root view) */}
                  <div className="relative">
                    <button
                      onClick={() => {
                        const newFilter = 'all';
                        setFilterType(newFilter);
                        storeFilter(newFilter);
                        setShowFilterMenu(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                        filterType === 'all' ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400' : 'text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {t('items.title')}
                    </button>
                    {!currentFolderId && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const newValue = !showFolders;
                          setShowFolders(newValue);
                          LocalPreferencesService.setShowFolders(newValue);
                          setShowFilterMenu(false);
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                      >
                        <span>{t('items.filters.folders')}</span>
                        <svg
                          className={`w-5 h-5 ${showFolders ? 'text-orange-500 dark:text-orange-400' : 'text-gray-400 dark:text-gray-500'}`}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          {showFolders && (
                            <polyline points="7 12 10 15 17 8" />
                          )}
                        </svg>
                      </button>
                    )}
                  </div>
                  <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                  {/* Item type filters - dynamically generated from ItemTypes */}
                  {ITEM_TYPE_OPTIONS.map((option) => (
                    <button
                      key={option.type}
                      onClick={() => {
                        const newFilter = option.type;
                        setFilterType(newFilter);
                        storeFilter(newFilter);
                        setShowFilterMenu(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 ${
                        filterType === option.type ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400' : 'text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      <span className={filterType === option.type ? 'text-orange-500 dark:text-orange-400' : 'text-gray-400 dark:text-gray-500'}>
                        {option.iconSvg}
                      </span>
                      {t(option.titleKey)}
                    </button>
                  ))}
                  <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                  {/* Passkeys filter */}
                  <button
                    onClick={() => {
                      const newFilter = 'passkeys';
                      setFilterType(newFilter);
                      storeFilter(newFilter);
                      setShowFilterMenu(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                      filterType === 'passkeys' ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400' : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {t('items.filters.passkeys')}
                  </button>
                  {/* Attachments filter */}
                  <button
                    onClick={() => {
                      const newFilter = 'attachments';
                      setFilterType(newFilter);
                      storeFilter(newFilter);
                      setShowFilterMenu(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                      filterType === 'attachments' ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400' : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {t('common.attachments')}
                  </button>
                  {/* TOTP filter */}
                  <button
                    onClick={() => {
                      const newFilter = 'totp';
                      setFilterType(newFilter);
                      storeFilter(newFilter);
                      setShowFilterMenu(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                      filterType === 'totp' ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400' : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {t('items.filters.totp')}
                  </button>
                  <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                  {/* Recently deleted link */}
                  <button
                    onClick={() => {
                      setShowFilterMenu(false);
                      navigate('/items/deleted');
                    }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 flex items-center justify-between"
                  >
                    <span>{t('recentlyDeleted.title')}</span>
                    {recentlyDeletedCount > 0 && (
                      <span className="text-gray-400 dark:text-gray-500">
                        {recentlyDeletedCount}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Sort button */}
          <div className="relative">
            <button
              onClick={() => setShowSortMenu(!showSortMenu)}
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title={t('items.sort.title')}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="6" x2="16" y2="6" />
                <line x1="4" y1="12" x2="12" y2="12" />
                <line x1="4" y1="18" x2="8" y2="18" />
                <polyline points="15 15 18 18 21 15" />
                <line x1="18" y1="12" x2="18" y2="18" />
              </svg>
            </button>
            {showSortMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowSortMenu(false)}
                />
                <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl ring-1 ring-black/5 dark:ring-white/10 z-20">
                  <div className="py-1">
                    {SORT_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        onClick={async () => {
                          setSortOrder(option.value);
                          setShowSortMenu(false);
                          // Save to settings and trigger vault sync
                          await executeVaultMutationAsync(async () => {
                            dbContext.sqliteClient?.settings.setCredentialsSortOrder(option.value);
                          });
                        }}
                        className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 ${
                          sortOrder === option.value ? 'text-orange-600 dark:text-orange-400' : 'text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {sortOrder === option.value ? (
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          <span className="w-4" />
                        )}
                        <span>{t(option.labelKey)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          <ReloadButton onClick={syncVaultAndRefresh} />
        </div>
      </div>

      {items.length > 0 ? (
        <div className="mb-4">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={`${t('content.searchVault')}`}
            autoFocus
            className="w-full p-2 border dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      ) : (
        <></>
      )}

      {items.length === 0 ? (
        <>
          <div className="text-gray-500 dark:text-gray-400 space-y-2 mb-10">
            <p>
              {t('items.welcomeTitle')}
            </p>
            <p>
              {t('items.welcomeDescription')}
            </p>
          </div>
        </>
      ) : filteredItems.length === 0 && folders.length === 0 && !hasItemsInFoldersOnly ? (
        <div className="text-gray-500 dark:text-gray-400 space-y-3 mb-10">
          {/* Show filter/search-specific messages only when actively filtering or searching */}
          {(filterType !== 'all' || searchTerm) && (
            <>
              <p>
                {/* Different messages based on what's causing no results */}
                {searchTerm && filterType !== 'all'
                  // Both search and filter active
                  ? t('items.noMatchingItemsWithFilter', { filter: getFilterTitle(), search: searchTerm })
                  : searchTerm
                    // Only search active
                    ? t('items.noMatchingItemsSearch', { search: searchTerm })
                    // Only filter active (no search)
                    : filterType !== 'all'
                      ? t('items.noMatchingItems')
                      : t('items.noMatchingItems')
                }
              </p>
              {/* Clear filter/search buttons */}
              <div className="flex flex-wrap gap-2">
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                    {t('items.clearSearch')}
                  </button>
                )}
                {filterType !== 'all' && (
                  <button
                    onClick={() => {
                      setFilterType('all');
                      localStorage.removeItem(FILTER_STORAGE_KEY);
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-orange-100 dark:bg-orange-900/30 hover:bg-orange-200 dark:hover:bg-orange-900/50 text-orange-700 dark:text-orange-300 rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                    {t('items.clearFilter')}
                  </button>
                )}
              </div>
            </>
          )}
          {/* Show help text when inside an empty folder */}
          {currentFolderId && (
            <p className="text-sm">
              {t('items.emptyFolderHint')}
            </p>
          )}
        </div>
      ) : hasItemsInFoldersOnly && filteredItems.length === 0 && !currentFolderId && !searchTerm ? (
        /* Show message when all items are in folders and we're at root level */
        <>
          {/* Folders as inline pills */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {folders.map(folder => (
              <FolderPill
                key={folder.id}
                folder={folder}
                onClick={() => handleFolderClick(folder.id, folder.name)}
              />
            ))}
            <button
              onClick={handleAddFolder}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-full transition-colors focus:outline-none text-gray-500 dark:text-gray-400 hover:text-orange-600 dark:hover:text-orange-400 hover:bg-gray-100 dark:hover:bg-gray-700/50"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <svg className="w-3 h-3 -ml-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
          <div className="text-gray-500 dark:text-gray-400 text-sm">
            <p>{t('items.allItemsInFolders')}</p>
          </div>
        </>
      ) : (
        <>
          {/* Folders as inline pills (only show at root level when not searching and showFolders is enabled) */}
          {!currentFolderId && !searchTerm && showFolders && (
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {folders.map(folder => (
                <FolderPill
                  key={folder.id}
                  folder={folder}
                  onClick={() => handleFolderClick(folder.id, folder.name)}
                />
              ))}
              <button
                onClick={handleAddFolder}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-full transition-colors focus:outline-none ${
                  folders.length > 0
                    ? 'text-gray-500 dark:text-gray-400 hover:text-orange-600 dark:hover:text-orange-400 hover:bg-gray-100 dark:hover:bg-gray-700/50'
                    : 'text-gray-400 dark:text-gray-500 border border-dashed border-gray-300 dark:border-gray-600 hover:border-orange-400 dark:hover:border-orange-500 hover:text-orange-600 dark:hover:text-orange-400'
                }`}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <svg className="w-3 h-3 -ml-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {folders.length === 0 && (
                  /**
                   * Only show text when there are no folders yet
                   * if there are folders we hide the text to save on UI space
                   */
                  <span>{t('items.newFolder')}</span>
                )}
              </button>
            </div>
          )}

          {/* Items */}
          {sortedItems.length > 0 && (
            <ul id="items-list" className="space-y-2">
              {sortedItems.map(item => (
                <ItemCard
                  key={item.Id}
                  item={item}
                  showFolderPath={!!searchTerm && !!item.FolderPath}
                />
              ))}
            </ul>
          )}

          {/* Clear filter/search pills at bottom of list when filtering or searching */}
          {(filterType !== 'all' || searchTerm) && (
            <div className="flex flex-wrap justify-center gap-2 mt-4 pt-4">
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                  {t('items.clearSearch')}
                </button>
              )}
              {filterType !== 'all' && (
                <button
                  onClick={() => {
                    setFilterType('all');
                    localStorage.removeItem(FILTER_STORAGE_KEY);
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-orange-100 dark:bg-orange-900/30 hover:bg-orange-200 dark:hover:bg-orange-900/50 text-orange-700 dark:text-orange-300 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                  {t('items.clearFilter')}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* Create Folder Modal */}
      <FolderModal
        isOpen={showFolderModal}
        onClose={() => setShowFolderModal(false)}
        onSave={handleSaveFolder}
        mode="create"
      />

      {/* Edit Folder Modal */}
      <FolderModal
        isOpen={showEditFolderModal}
        onClose={() => setShowEditFolderModal(false)}
        onSave={handleEditFolder}
        initialName={currentFolderName || ''}
        mode="edit"
      />

      {/* Delete Folder Modal */}
      <DeleteFolderModal
        isOpen={showDeleteFolderModal}
        onClose={() => setShowDeleteFolderModal(false)}
        onDeleteFolderOnly={handleDeleteFolderOnly}
        onDeleteFolderAndContents={handleDeleteFolderAndContents}
        itemCount={filteredItems.length}
      />
    </div>
  );
};

export default ItemsList;
