import { MaterialIcons } from '@expo/vector-icons';
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import Toast from 'react-native-toast-message';

import type { FieldHistory, FieldType } from '@/utils/dist/core/models/vault';
import { FieldTypes } from '@/utils/dist/core/models/vault';

import { useColors, useColorScheme } from '@/hooks/useColorScheme';
import { useDb } from '@/context/DbContext';
import { copyToClipboardWithExpiration } from '@/utils/ClipboardUtility';
import { useAuth } from '@/context/AuthContext';

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
  const colorScheme = useColorScheme();
  const dbContext = useDb();
  const { getClipboardClearTimeout } = useAuth();
  const [history, setHistory] = useState<FieldHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleValues, setVisibleValues] = useState<Set<string>>(new Set());

  // For non-hidden fields, show values by default
  const shouldMaskByDefault = isHidden || fieldType === FieldTypes.Password || fieldType === FieldTypes.Hidden;

  useEffect(() => {
    if (!isOpen || !dbContext?.sqliteClient) {
      return;
    }

    const loadHistory = async (): Promise<void> => {
      if (!dbContext.sqliteClient) return;

      try {
        setLoading(true);
        const historyRecords = await dbContext.sqliteClient.items.getFieldHistory(itemId, fieldKey);
        setHistory(historyRecords);
      } catch (error) {
        console.error('Error loading field history:', error);
      } finally {
        setLoading(false);
      }
    };

    void loadHistory();
  }, [isOpen, dbContext?.sqliteClient, itemId, fieldKey]);

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

  const styles = StyleSheet.create({
    backdrop: {
      alignItems: 'center',
      // Lighter backdrop in dark mode for better contrast against black background
      backgroundColor: colorScheme === 'dark' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.5)',
      flex: 1,
      justifyContent: 'center',
    },
    container: {
      backgroundColor: colors.background,
      borderRadius: 12,
      marginHorizontal: 16,
      maxHeight: '80%',
      width: '95%',
    },
    header: {
      borderBottomColor: colors.accentBorder,
      borderBottomWidth: 1,
      padding: 20,
    },
    title: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
    },
    body: {
      maxHeight: 400,
      padding: 20,
    },
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
      borderBottomColor: colors.accentBorder,
      borderBottomWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    historyDate: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '500',
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
    footer: {
      borderTopColor: colors.accentBorder,
      borderTopWidth: 1,
      padding: 16,
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

  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>{fieldLabel} {t('items.history')}</Text>
          </View>

          <ScrollView style={styles.body}>
            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : history.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>
                  {t('items.noHistoryAvailable')}
                </Text>
              </View>
            ) : (
              <View>
                {history.map((record) => {
                  const values = parseValueSnapshot(record.ValueSnapshot);

                  return (
                    <View key={record.Id} style={styles.historyItem}>
                      <View style={styles.historyHeader}>
                        <Text style={styles.historyDate}>
                          {formatDate(record.ChangedAt)}
                        </Text>
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
            )}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
            >
              <Text style={styles.closeButtonText}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default FieldHistoryModal;
