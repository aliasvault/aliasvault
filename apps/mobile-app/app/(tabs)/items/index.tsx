import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, Platform, Animated, TextInput, TouchableOpacity, View, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import type { Folder } from '@/utils/db/repositories/FolderRepository';
import type { Item, ItemType } from '@/utils/dist/core/models/vault';
import { getFieldValue, FieldKey, ItemTypes } from '@/utils/dist/core/models/vault';
import emitter from '@/utils/EventEmitter';
import { VaultAuthenticationError } from '@/utils/types/errors/VaultAuthenticationError';

import { useColors } from '@/hooks/useColorScheme';
import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';
import { useVaultMutate } from '@/hooks/useVaultMutate';
import { useVaultSync } from '@/hooks/useVaultSync';

import Logo from '@/assets/images/logo.svg';
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
  const { serviceUrl: serviceUrlParam } = useLocalSearchParams<{ serviceUrl?: string }>();
  const [itemsList, setItemsList] = useState<Item[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useMinDurationLoading(false, 200);
  const [refreshing, setRefreshing] = useMinDurationLoading(false, 200);
  const [serviceUrl, setServiceUrl] = useState<string | null>(null);
  const { executeVaultMutation } = useVaultMutate();
  const [showFolderModal, setShowFolderModal] = useState(false);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  // Recently deleted count state
  const [recentlyDeletedCount, setRecentlyDeletedCount] = useState(0);

  const authContext = useApp();
  const dbContext = useDb();

  const isAuthenticated = authContext.isLoggedIn;
  const isDatabaseAvailable = dbContext.dbAvailable;

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
   * Load items (credentials), folders, and recently deleted count.
   */
  const loadItems = useCallback(async (): Promise<void> => {
    try {
      const [items, loadedFolders, deletedCount] = await Promise.all([
        dbContext.sqliteClient!.items.getAll(),
        dbContext.sqliteClient!.folders.getAll(),
        dbContext.sqliteClient!.items.getRecentlyDeletedCount()
      ]);
      setItemsList(items);
      setFolders(loadedFolders);
      setRecentlyDeletedCount(deletedCount);
      setIsLoadingItems(false);
    } catch (err) {
      Toast.show({
        type: 'error',
        text1: t('items.errorLoadingItems'),
        text2: err instanceof Error ? err.message : 'Unknown error',
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

    if (authContext.isOffline) {
      setRefreshing(false);
      setIsLoadingItems(false);
      return;
    }

    try {
      await syncVault({
        /**
         * On success.
         */
        onSuccess: async (hasNewVault) => {
          await loadItems();
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

          Alert.alert(
            t('common.error'),
            error,
            [{ text: t('common.ok'), style: 'default' }]
          );
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
          text2: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  }, [syncVault, loadItems, setIsLoadingItems, setRefreshing, authContext, dbContext, router, t]);

  useEffect(() => {
    if (!isAuthenticated || !isDatabaseAvailable) {
      return;
    }

    setIsLoadingItems(true);
    loadItems();
  }, [isAuthenticated, isDatabaseAvailable, loadItems, setIsLoadingItems]);

  // Set header for Android
  useEffect(() => {
    navigation.setOptions({
      /**
       * Define custom header which is shown on Android. iOS displays the custom CollapsibleHeader component instead.
       */
      headerTitle: (): React.ReactNode => {
        if (Platform.OS === 'android') {
          return (
            <AndroidHeader title={t('items.title')} />
          );
        }
        return <Text>{t('items.title')}</Text>;
      },
    });
  }, [navigation, t]);

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
   */
  const handleAddItem = useCallback(() => {
    router.push('/(tabs)/items/add-edit');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [router]);

  // Handle deep link parameters
  useFocusEffect(
    useCallback(() => {
      const currentServiceUrl = serviceUrlParam ? decodeURIComponent(serviceUrlParam) : null;
      setServiceUrl(currentServiceUrl);
    }, [serviceUrlParam])
  );

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
    // Filter button styles
    filterButton: {
      alignItems: 'center',
      flexDirection: 'row',
      marginBottom: 16,
      gap: 8,
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
    filterMenu: {
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      marginBottom: 8,
      overflow: 'hidden',
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
      marginBottom: 12,
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
    // Service URL styles
    serviceUrlContainer: {
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 12,
      padding: 12,
    },
    serviceUrlText: {
      color: colors.text,
      flex: 1,
      fontSize: 14,
    },
    serviceUrlDismiss: {
      padding: 4,
    },
    // Empty state styles
    emptyText: {
      color: colors.textMuted,
      fontSize: 16,
      marginTop: 24,
      opacity: 0.7,
      textAlign: 'center',
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
   * Render the filter menu.
   */
  const renderFilterMenu = (): React.ReactNode => {
    if (!showFilterMenu) {
      return null;
    }

    return (
      <ThemedView style={styles.filterMenu}>
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

        {/* Recently deleted link */}
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

        {/* Service URL notice */}
        {serviceUrl && (
          <View style={styles.serviceUrlContainer}>
            <MaterialIcons name="link" size={18} color={colors.textMuted} />
            <Text style={styles.serviceUrlText} numberOfLines={1}>
              {serviceUrl}
            </Text>
            <TouchableOpacity style={styles.serviceUrlDismiss} onPress={() => setServiceUrl(null)}>
              <MaterialIcons name="close" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        {/* Filter menu */}
        {renderFilterMenu()}

        {/* Folder pills */}
        {foldersWithCounts.length > 0 && (
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

        {/* New folder button when no folders exist */}
        {foldersWithCounts.length === 0 && !searchQuery && (
          <View style={styles.folderPillsContainer}>
            <TouchableOpacity
              style={styles.newFolderButton}
              onPress={() => setShowFolderModal(true)}
            >
              <MaterialIcons name="create-new-folder" size={16} color={colors.textMuted} />
              <Text style={styles.newFolderButtonText}>{t('items.folders.newFolder')}</Text>
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
  };

  /**
   * Render empty state.
   */
  const renderEmptyComponent = (): React.ReactNode => {
    if (isLoadingItems) {
      return null;
    }

    return (
      <View>
        <Text style={styles.emptyText}>
          {searchQuery
            ? t('items.noMatchingItems')
            : filterType === 'passkeys'
              ? t('items.noPasskeysFound')
              : filterType === 'attachments'
                ? t('items.noAttachmentsFound')
                : isItemTypeFilter(filterType)
                  ? t('items.noItemsOfTypeFound', { type: getFilterTitle() })
                  : t('items.noItemsFound')
          }
        </Text>
      </View>
    );
  };

  return (
    <ThemedContainer style={styles.container}>
      <CollapsibleHeader
        title={t('items.title')}
        scrollY={scrollY}
        showNavigationHeader={true}
        alwaysVisible={true}
      />
      <ThemedView style={styles.stepContainer}>
        {/* FAB */}
        <RobustPressable style={styles.fab} onPress={handleAddItem}>
          <MaterialIcons name="add" style={styles.fabIcon} />
        </RobustPressable>

        {/* Item list */}
        <Animated.FlatList
          ref={flatListRef}
          data={isLoadingItems ? Array(4).fill(null) : filteredItems}
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
        />
      </ThemedView>

      {/* Create folder modal */}
      <FolderModal
        isOpen={showFolderModal}
        onClose={() => setShowFolderModal(false)}
        onSave={handleCreateFolder}
        mode="create"
      />
    </ThemedContainer>
  );
}
