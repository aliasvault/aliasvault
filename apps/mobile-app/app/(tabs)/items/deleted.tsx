import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';

import type { ItemWithDeletedAt } from '@/utils/db/mappers/ItemMapper';
import emitter from '@/utils/EventEmitter';

import { useColors } from '@/hooks/useColorScheme';
import { useVaultMutate } from '@/hooks/useVaultMutate';

import { ConfirmDeleteModal } from '@/components/items/ConfirmDeleteModal';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { useDb } from '@/context/DbContext';

/**
 * Calculate days remaining until permanent deletion.
 * @param deletedAt - ISO timestamp when item was deleted
 * @param retentionDays - Number of days to retain (default 30)
 * @returns Number of days remaining, or 0 if already expired
 */
const getDaysRemaining = (deletedAt: string, retentionDays: number = 30): number => {
  const deletedDate = new Date(deletedAt);
  const expiryDate = new Date(deletedDate.getTime() + retentionDays * 24 * 60 * 60 * 1000);
  const now = new Date();
  const daysRemaining = Math.ceil((expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(0, daysRemaining);
};

/**
 * Recently Deleted page - shows items in trash that can be restored or permanently deleted.
 */
export default function RecentlyDeletedScreen(): React.ReactNode {
  const { t } = useTranslation();
  const colors = useColors();
  const dbContext = useDb();
  const { executeVaultMutation } = useVaultMutate();

  const [items, setItems] = useState<ItemWithDeletedAt[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(true);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [showConfirmEmptyAll, setShowConfirmEmptyAll] = useState(false);

  /**
   * Load recently deleted items.
   */
  const loadItems = useCallback(async (): Promise<void> => {
    if (!dbContext.sqliteClient) {
      return;
    }

    try {
      const results = await dbContext.sqliteClient.items.getRecentlyDeleted();
      setItems(results);
    } catch (err) {
      console.error('Error loading deleted items:', err);
      Toast.show({
        type: 'error',
        text1: t('items.errorLoadingItems'),
        text2: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setIsLoadingItems(false);
    }
  }, [dbContext.sqliteClient, t]);

  // Load items when screen is focused
  useFocusEffect(
    useCallback(() => {
      setIsLoadingItems(true);
      loadItems();
    }, [loadItems])
  );

  /**
   * Restore an item from Recently Deleted.
   */
  const handleRestore = useCallback(async (itemId: string): Promise<void> => {
    if (!dbContext.sqliteClient) {
      return;
    }

    await executeVaultMutation(async () => {
      await dbContext.sqliteClient!.items.restore(itemId);
    });

    await loadItems();
    emitter.emit('credentialChanged');

    Toast.show({
      type: 'success',
      text1: t('items.recentlyDeleted.itemRestored'),
    });
  }, [dbContext.sqliteClient, executeVaultMutation, loadItems, t]);

  /**
   * Permanently delete an item.
   */
  const handlePermanentDelete = useCallback(async (): Promise<void> => {
    if (!dbContext.sqliteClient || !selectedItemId) {
      return;
    }

    await executeVaultMutation(async () => {
      await dbContext.sqliteClient!.items.permanentlyDelete(selectedItemId);
    });

    await loadItems();
    emitter.emit('credentialChanged');
    setShowConfirmDelete(false);
    setSelectedItemId(null);

    Toast.show({
      type: 'success',
      text1: t('items.recentlyDeleted.itemDeleted'),
    });
  }, [dbContext.sqliteClient, executeVaultMutation, loadItems, selectedItemId, t]);

  /**
   * Empty all items from Recently Deleted (permanent delete all).
   */
  const handleEmptyAll = useCallback(async (): Promise<void> => {
    if (!dbContext.sqliteClient) {
      return;
    }

    await executeVaultMutation(async () => {
      for (const item of items) {
        await dbContext.sqliteClient!.items.permanentlyDelete(item.Id);
      }
    });

    await loadItems();
    emitter.emit('credentialChanged');
    setShowConfirmEmptyAll(false);

    Toast.show({
      type: 'success',
      text1: t('items.recentlyDeleted.allItemsDeleted'),
    });
  }, [dbContext.sqliteClient, executeVaultMutation, items, loadItems, t]);

  /**
   * Handle closing the delete confirmation modal.
   */
  const handleCloseDeleteModal = useCallback((): void => {
    setShowConfirmDelete(false);
    setSelectedItemId(null);
  }, []);

  const styles = StyleSheet.create({
    headerText: {
      color: colors.textMuted,
      fontSize: 13,
      marginBottom: 16,
    },
    headerRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    itemCount: {
      color: colors.textMuted,
      fontSize: 13,
    },
    emptyAllButton: {
      paddingVertical: 4,
    },
    emptyAllButtonText: {
      color: colors.destructive,
      fontSize: 14,
      fontWeight: '500',
    },
    emptyContainer: {
      alignItems: 'center',
      paddingTop: 40,
    },
    emptyTitle: {
      color: colors.textMuted,
      fontSize: 16,
      marginBottom: 8,
    },
    emptyDescription: {
      color: colors.textMuted,
      fontSize: 14,
      opacity: 0.7,
      textAlign: 'center',
    },
    itemCard: {
      backgroundColor: colors.accentBackground,
      borderRadius: 8,
      marginBottom: 8,
      padding: 12,
    },
    itemContent: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    itemLogo: {
      borderRadius: 4,
      height: 32,
      marginRight: 12,
      width: 32,
    },
    itemLogoPlaceholder: {
      alignItems: 'center',
      backgroundColor: colors.primary + '20',
      borderRadius: 4,
      height: 32,
      justifyContent: 'center',
      marginRight: 12,
      width: 32,
    },
    itemInfo: {
      flex: 1,
    },
    itemName: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 4,
    },
    itemExpiry: {
      color: colors.textMuted,
      fontSize: 14,
    },
    itemExpiryWarning: {
      color: colors.destructive,
    },
    itemActions: {
      flexDirection: 'row',
      gap: 8,
    },
    restoreButton: {
      backgroundColor: colors.primary + '15',
      borderRadius: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    restoreButtonText: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '500',
    },
    deleteButton: {
      backgroundColor: colors.destructive + '15',
      borderRadius: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    deleteButtonText: {
      color: colors.destructive,
      fontSize: 14,
      fontWeight: '500',
    },
    loadingContainer: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      paddingTop: 60,
    },
  });

  /**
   * Render an item card.
   */
  const renderItem = (item: ItemWithDeletedAt): React.ReactElement => {
    const daysRemaining = item.DeletedAt ? getDaysRemaining(item.DeletedAt) : 30;

    return (
      <View key={item.Id} style={styles.itemCard}>
        <View style={styles.itemContent}>
          {/* Item logo */}
          {item.Logo ? (
            <Image
              source={{ uri: `data:image/png;base64,${Buffer.from(item.Logo).toString('base64')}` }}
              style={styles.itemLogo}
            />
          ) : (
            <View style={styles.itemLogoPlaceholder}>
              <MaterialIcons name="lock" size={18} color={colors.primary} />
            </View>
          )}

          {/* Item info */}
          <View style={styles.itemInfo}>
            <Text style={styles.itemName} numberOfLines={1}>
              {item.Name || t('items.untitled')}
            </Text>
            <Text style={[
              styles.itemExpiry,
              daysRemaining <= 3 && styles.itemExpiryWarning
            ]}>
              {daysRemaining > 0
                ? t('items.recentlyDeleted.daysRemaining', { count: daysRemaining })
                : t('items.recentlyDeleted.expiringSoon')}
            </Text>
          </View>

          {/* Action buttons */}
          <View style={styles.itemActions}>
            <TouchableOpacity
              style={styles.restoreButton}
              onPress={() => handleRestore(item.Id)}
            >
              <Text style={styles.restoreButtonText}>
                {t('items.recentlyDeleted.restore')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={() => {
                setSelectedItemId(item.Id);
                setShowConfirmDelete(true);
              }}
            >
              <Text style={styles.deleteButtonText}>
                {t('common.delete')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <ThemedContainer>

      {isLoadingItems ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ThemedScrollView>
          {items.length > 0 ? (
            <>
              <View style={styles.headerRow}>
                <ThemedText style={styles.itemCount}>
                  {items.length} {items.length === 1 ? 'item' : 'items'}
                </ThemedText>
                <TouchableOpacity
                  style={styles.emptyAllButton}
                  onPress={() => setShowConfirmEmptyAll(true)}
                >
                  <Text style={styles.emptyAllButtonText}>
                    {t('items.recentlyDeleted.emptyAll')}
                  </Text>
                </TouchableOpacity>
              </View>
              <ThemedText style={styles.headerText}>
                {t('items.recentlyDeleted.description')}
              </ThemedText>
              {items.map(renderItem)}
            </>
          ) : (
            <View style={styles.emptyContainer}>
              <ThemedText style={styles.emptyTitle}>
                {t('items.recentlyDeleted.noItems')}
              </ThemedText>
              <ThemedText style={styles.emptyDescription}>
                {t('items.recentlyDeleted.noItemsDescription')}
              </ThemedText>
            </View>
          )}
        </ThemedScrollView>
      )}

      {/* Confirm Delete Modal */}
      <ConfirmDeleteModal
        isOpen={showConfirmDelete && !!selectedItemId}
        onClose={handleCloseDeleteModal}
        onConfirm={handlePermanentDelete}
        title={t('items.recentlyDeleted.confirmDeleteTitle')}
        message={t('items.recentlyDeleted.confirmDeleteMessage')}
        confirmText={t('items.recentlyDeleted.deletePermanently')}
      />

      {/* Confirm Empty All Modal */}
      <ConfirmDeleteModal
        isOpen={showConfirmEmptyAll}
        onClose={() => setShowConfirmEmptyAll(false)}
        onConfirm={handleEmptyAll}
        title={t('items.recentlyDeleted.confirmEmptyAllTitle')}
        message={t('items.recentlyDeleted.confirmEmptyAllMessage', { count: items.length })}
        confirmText={t('items.recentlyDeleted.emptyAll')}
      />
    </ThemedContainer>
  );
}
