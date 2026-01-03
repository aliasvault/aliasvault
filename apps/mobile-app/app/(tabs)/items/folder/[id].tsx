import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Platform, View, Text, TextInput, TouchableOpacity, RefreshControl, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import type { Folder } from '@/utils/db/repositories/FolderRepository';
import type { Item } from '@/utils/dist/core/models/vault';
import { getFieldValue, FieldKey } from '@/utils/dist/core/models/vault';
import emitter from '@/utils/EventEmitter';
import { VaultAuthenticationError } from '@/utils/types/errors/VaultAuthenticationError';

import { useColors } from '@/hooks/useColorScheme';
import { useMinDurationLoading } from '@/hooks/useMinDurationLoading';
import { useVaultMutate } from '@/hooks/useVaultMutate';
import { useVaultSync } from '@/hooks/useVaultSync';

import { DeleteFolderModal } from '@/components/folders/DeleteFolderModal';
import { FolderModal } from '@/components/folders/FolderModal';
import { ItemCard } from '@/components/items/ItemCard';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { SkeletonLoader } from '@/components/ui/SkeletonLoader';
import { useApp } from '@/context/AppContext';
import { useDb } from '@/context/DbContext';

/**
 * Folder view screen - displays items within a specific folder.
 * Simplified view with search scoped to this folder only.
 */
export default function FolderViewScreen(): React.ReactNode {
  const { id: folderId } = useLocalSearchParams<{ id: string }>();
  const { syncVault } = useVaultSync();
  const colors = useColors();
  const { t } = useTranslation();
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList<Item | null>>(null);

  const [itemsList, setItemsList] = useState<Item[]>([]);
  const [folder, setFolder] = useState<Folder | null>(null);
  const [isLoadingItems, setIsLoadingItems] = useMinDurationLoading(false, 200);
  const [refreshing, setRefreshing] = useMinDurationLoading(false, 200);
  const { executeVaultMutation } = useVaultMutate();

  // Search state (scoped to this folder)
  const [searchQuery, setSearchQuery] = useState('');

  // Folder modals
  const [showEditFolderModal, setShowEditFolderModal] = useState(false);
  const [showDeleteFolderModal, setShowDeleteFolderModal] = useState(false);

  const authContext = useApp();
  const dbContext = useDb();

  const isAuthenticated = authContext.isLoggedIn;
  const isDatabaseAvailable = dbContext.dbAvailable;

  /**
   * Filter items by search query (within this folder only).
   */
  const filteredItems = useMemo(() => {
    const searchLower = searchQuery.toLowerCase().trim();

    if (!searchLower) {
      return itemsList;
    }

    return itemsList.filter(item => {
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
  }, [itemsList, searchQuery]);

  /**
   * Load items in this folder and folder details.
   */
  const loadItems = useCallback(async (): Promise<void> => {
    if (!folderId) {
      return;
    }

    try {
      const [items, folders] = await Promise.all([
        dbContext.sqliteClient!.items.getAll(),
        dbContext.sqliteClient!.folders.getAll()
      ]);
      // Filter to only items in this folder
      const folderItems = items.filter((item: Item) => item.FolderId === folderId);
      setItemsList(folderItems);

      // Find this folder
      const currentFolder = folders.find((f: Folder) => f.Id === folderId);
      setFolder(currentFolder || null);
      setIsLoadingItems(false);
    } catch (err) {
      Toast.show({
        type: 'error',
        text1: t('items.errorLoadingItems'),
        text2: err instanceof Error ? err.message : 'Unknown error',
      });
      setIsLoadingItems(false);
    }
  }, [dbContext.sqliteClient, folderId, setIsLoadingItems, t]);

  useEffect(() => {
    // Add listener for item changes
    const itemChangedSub = emitter.addListener('credentialChanged', async () => {
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
  }, [syncVault, loadItems, setIsLoadingItems, setRefreshing, authContext, router, t]);

  useEffect(() => {
    if (!isAuthenticated || !isDatabaseAvailable) {
      return;
    }

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
  const onItemDelete = useCallback(async (itemId: string): Promise<void> => {
    await executeVaultMutation(async () => {
      await dbContext.sqliteClient!.items.trash(itemId);
    });

    // Reload items to reflect the deletion
    await loadItems();
  }, [dbContext.sqliteClient, executeVaultMutation, loadItems]);

  /**
   * Rename the folder.
   */
  const handleEditFolder = useCallback(async (newName: string) => {
    if (!folderId) {
      return;
    }

    await executeVaultMutation(async () => {
      await dbContext.sqliteClient!.folders.update(folderId, newName);
    });
    await loadItems();
    setShowEditFolderModal(false);
  }, [dbContext.sqliteClient, folderId, executeVaultMutation, loadItems]);

  /**
   * Delete the folder (keep items - move them to root).
   */
  const handleDeleteFolderOnly = useCallback(async () => {
    if (!folderId) {
      return;
    }

    await executeVaultMutation(async () => {
      await dbContext.sqliteClient!.folders.delete(folderId);
    });
    router.back();
  }, [dbContext.sqliteClient, folderId, executeVaultMutation, router]);

  /**
   * Delete the folder and all its contents.
   */
  const handleDeleteFolderAndContents = useCallback(async () => {
    if (!folderId) {
      return;
    }

    await executeVaultMutation(async () => {
      await dbContext.sqliteClient!.folders.deleteWithContents(folderId);
    });
    router.back();
  }, [dbContext.sqliteClient, folderId, executeVaultMutation, router]);

  /**
   * Handle FAB press - navigate to add item screen with folder pre-selected.
   */
  const handleAddItem = useCallback(() => {
    router.push(`/(tabs)/items/add-edit?folderId=${folderId}` as '/(tabs)/items/add-edit');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [folderId, router]);

  // Header styles (stable, not dependent on colors) - prefixed with _ as styles are inlined in useEffect
  const _headerStyles = StyleSheet.create({
    headerButton: {
      padding: 8,
    },
    headerRightContainer: {
      flexDirection: 'row',
      gap: 4,
    },
  });

  const paddingTop = Platform.OS === 'ios' ? 16 : 16;
  const paddingBottom = Platform.OS === 'ios' ? insets.bottom + 60 : 40;

  const styles = StyleSheet.create({
    container: {
      paddingHorizontal: 0,
      paddingTop: paddingTop + 100,
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
    // Item count styles
    itemCountContainer: {
      marginBottom: 12,
    },
    itemCountText: {
      color: colors.textMuted,
      fontSize: 14,
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
   * Render the list header with search.
   */
  const renderListHeader = (): React.ReactNode => {
    return (
      <ThemedView>
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
      {/* FAB */}
      <RobustPressable style={styles.fab} onPress={handleAddItem}>
        <MaterialIcons name="add" style={styles.fabIcon} />
      </RobustPressable>

      {/* Item list */}
      <FlatList
        ref={flatListRef}
        data={isLoadingItems ? Array(4).fill(null) : filteredItems}
        keyExtractor={(itm, index) => itm?.Id ?? `skeleton-${index}`}
        keyboardShouldPersistTaps='handled'
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

      {/* Folder modals */}
      <FolderModal
        isOpen={showEditFolderModal}
        onClose={() => setShowEditFolderModal(false)}
        onSave={handleEditFolder}
        initialName={folder?.Name || ''}
        mode="edit"
      />
      <DeleteFolderModal
        isOpen={showDeleteFolderModal}
        onClose={() => setShowDeleteFolderModal(false)}
        onDeleteFolderOnly={handleDeleteFolderOnly}
        onDeleteFolderAndContents={handleDeleteFolderAndContents}
        itemCount={itemsList.length}
      />
    </ThemedContainer>
  );
}
