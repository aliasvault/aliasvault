import { MaterialIcons } from '@expo/vector-icons';
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import Toast from 'react-native-toast-message';

import type { FieldHistory, FieldType } from '@/utils/dist/core/models/vault';
import { FieldTypes } from '@/utils/dist/core/models/vault';

import { useColors } from '@/hooks/useColorScheme';
import { useDb } from '@/context/DbContext';
import { copyToClipboardWithExpiration } from '@/utils/ClipboardUtility';
import { useAuth } from '@/context/AuthContext';
import { ModalWrapper } from '@/components/common/ModalWrapper';
import { useVaultMutate } from '@/hooks/useVaultMutate';
import { useDialog } from '@/context/DialogContext';

type FieldHistoryModalProps = {
  isOpen: boolean;
  onClose: () => void;
  itemId: string;
  fieldKey: string;
  fieldLabel: string;
  fieldType: FieldType;
  isHidden: boolean;
}

/**
 * Modal component for displaying field value history.
 * Shows historical values with dates.
 * For hidden/password fields, values are masked by default.
 * For other fields, values are visible by default.
 */
const FieldHistoryModal: React.FC<FieldHistoryModalProps> = ({
  isOpen,
  onClose,
  itemId,
  fieldKey,
  fieldLabel,
  fieldType,
  isHidden
}) => {
  const { t } = useTranslation();
  const colors = useColors();
  const dbContext = useDb();
  const { getClipboardClearTimeout } = useAuth();
  const { executeVaultMutation } = useVaultMutate();
  const { showConfirm } = useDialog();
  const [history, setHistory] = useState<FieldHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleValues, setVisibleValues] = useState<Set<string>>(new Set());

  // For non-hidden fields, show values by default
  const shouldMaskByDefault = isHidden || fieldType === FieldTypes.Password || fieldType === FieldTypes.Hidden;

  const loadHistory = useCallback(async (): Promise<void> => {
    if (!dbContext?.sqliteClient) return;

    try {
      setLoading(true);
      const historyRecords = await dbContext.sqliteClient.items.getFieldHistory(itemId, fieldKey);
      setHistory(historyRecords);
    } catch (error) {
      console.error('Error loading field history:', error);
    } finally {
      setLoading(false);
    }
  }, [dbContext?.sqliteClient, itemId, fieldKey]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    void loadHistory();
  }, [isOpen, loadHistory]);

  /**
   * Format a date string to a human readable format.
   */
  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  };

  /**
   * Parse a value snapshot into an array of values.
   */
  const parseValueSnapshot = (snapshot: string): string[] => {
    try {
      return JSON.parse(snapshot) as string[];
    } catch {
      return [snapshot];
    }
  };

  /**
   * Handle delete of a history record.
   */
  const handleDelete = async (historyId: string): Promise<void> => {
    if (!dbContext?.sqliteClient) {
      return;
    }

    try {
      // Use vault mutation to delete and sync in background
      await executeVaultMutation(async () => {
        await dbContext.sqliteClient!.items.deleteFieldHistory(historyId);
      });
      // Reload history after deletion
      await loadHistory();
      Toast.show({
        type: 'success',
        text1: t('common.delete'),
        position: 'bottom',
        visibilityTime: 2000,
      });
    } catch (error) {
      console.error('Error deleting field history:', error);
    }
  };

  /**
   * Show delete confirmation dialog.
   */
  const confirmDelete = (historyId: string): void => {
    showConfirm(
      t('common.delete'),
      t('items.deleteHistoryConfirm'),
      t('common.confirm'),
      () => handleDelete(historyId),
      {
        cancelText: t('common.cancel'),
        confirmStyle: 'destructive',
      }
    );
  };

  const styles = StyleSheet.create({
    loadingContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 40,
    },
    emptyContainer: {
      alignItems: 'center',
      paddingVertical: 40,
    },
    emptyText: {
      color: colors.textMuted,
      fontSize: 14,
    },
    historyItem: {
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      marginBottom: 12,
      overflow: 'hidden',
    },
    historyHeader: {
      alignItems: 'center',
      borderBottomColor: colors.accentBorder,
      borderBottomWidth: 1,
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    historyDate: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '500',
    },
    deleteButton: {
      padding: 4,
    },
    historyValue: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      padding: 12,
    },
    valueText: {
      color: colors.text,
      flex: 1,
      fontSize: 14,
    },
    actions: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
    },
    iconButton: {
      padding: 4,
    },
    closeButton: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      paddingVertical: 12,
    },
    closeButtonText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '500',
    },
  });

  const renderContent = (): React.ReactNode => {
    if (loading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      );
    }

    if (history.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>
            {t('items.noHistoryAvailable')}
          </Text>
        </View>
      );
    }

    return (
      <View>
        {history.map((record) => {
          const values = parseValueSnapshot(record.ValueSnapshot);

          return (
            <View key={record.Id} style={styles.historyItem}>
              <View style={styles.historyHeader}>
                <Text style={styles.historyDate}>
                  {formatDate(record.ChangedAt)}
                </Text>
                <TouchableOpacity
                  onPress={() => confirmDelete(record.Id)}
                  style={styles.deleteButton}
                  accessibilityLabel={t('common.delete')}
                >
                  <MaterialIcons
                    name="delete-outline"
                    size={18}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>
              </View>

              {values.map((value, idx) => {
                const valueId = `${record.Id}-${idx}`;
                const isVisible = visibleValues.has(valueId);
                const displayValue = shouldMaskByDefault && !isVisible
                  ? '•'.repeat(value.length)
                  : value;

                const handleCopy = async (): Promise<void> => {
                  try {
                    const timeoutSeconds = await getClipboardClearTimeout();
                    await copyToClipboardWithExpiration(value, timeoutSeconds);
                    Toast.show({
                      type: 'success',
                      text1: t('common.copied'),
                      position: 'bottom',
                      visibilityTime: 2000,
                    });
                  } catch (error) {
                    console.error('Failed to copy:', error);
                  }
                };

                const toggleVisibility = (): void => {
                  setVisibleValues(prev => {
                    const newSet = new Set(prev);
                    if (newSet.has(valueId)) {
                      newSet.delete(valueId);
                    } else {
                      newSet.add(valueId);
                    }
                    return newSet;
                  });
                };

                return (
                  <View key={idx} style={styles.historyValue}>
                    <Text style={styles.valueText} numberOfLines={1} ellipsizeMode="tail">
                      {displayValue}
                    </Text>
                    <View style={styles.actions}>
                      {shouldMaskByDefault && (
                        <TouchableOpacity
                          onPress={toggleVisibility}
                          style={styles.iconButton}
                        >
                          <MaterialIcons
                            name={isVisible ? 'visibility-off' : 'visibility'}
                            size={20}
                            color={colors.primary}
                          />
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        onPress={handleCopy}
                        style={styles.iconButton}
                      >
                        <MaterialIcons
                          name="content-copy"
                          size={18}
                          color={colors.textMuted}
                        />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          );
        })}
      </View>
    );
  };

  const footer = (
    <TouchableOpacity
      style={styles.closeButton}
      onPress={onClose}
    >
      <Text style={styles.closeButtonText}>{t('common.close')}</Text>
    </TouchableOpacity>
  );

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      title={`${fieldLabel} ${t('items.history')}`}
      scrollable
      maxScrollHeight={400}
      footer={footer}
      width="95%"
    >
      {renderContent()}
    </ModalWrapper>
  );
};

export default FieldHistoryModal;
