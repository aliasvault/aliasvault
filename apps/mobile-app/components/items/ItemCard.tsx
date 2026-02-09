/* eslint-disable max-len */
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, Text, TouchableOpacity, Keyboard, Platform } from 'react-native';
import ContextMenu, { ContextMenuOnPressNativeEvent } from 'react-native-context-menu-view';
import type { NativeSyntheticEvent } from 'react-native';
import Toast from 'react-native-toast-message';

import { ItemIcon } from '@/components/items/ItemIcon';
import { useDialog } from '@/context/DialogContext';
import { LocalPreferencesService } from '@/services/LocalPreferencesService';
import { useColors } from '@/hooks/useColorScheme';
import { copyToClipboardWithExpiration } from '@/utils/ClipboardUtility';
import type { Item } from '@/utils/dist/core/models/vault';
import { getFieldValue, FieldKey } from '@/utils/dist/core/models/vault';

type ItemCardProps = {
  item: Item;
  onItemDelete?: (itemId: string) => Promise<void>;
  showFolderPath?: boolean;
};

/**
 * Item card component for displaying vault items in a list.
 */
export function ItemCard({ item, onItemDelete, showFolderPath = false }: ItemCardProps): React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const { showConfirm } = useDialog();

  /**
   * Get the display text for an item, showing username by default,
   * falling back to email only if username is null/undefined/empty
   */
  const getItemDisplayText = (itm: Item): string => {
    // Show username if available
    const username = getFieldValue(itm, FieldKey.LoginUsername);
    if (username) {
      // Trim the return value to max. 38 characters.
      return username.length > 38 ? username.slice(0, 35) + '...' : username;
    }

    // Show email if username is not available
    const email = getFieldValue(itm, FieldKey.LoginEmail);
    if (email) {
      // Trim the return value to max. 38 characters.
      return email.length > 38 ? email.slice(0, 35) + '...' : email;
    }

    return '';
  };

  /**
   * Get the item name, trimming it to maximum length so it doesn't overflow the UI.
   */
  const getItemName = (itm: Item): string => {
    const returnValue = itm.Name || t('items.untitled');

    // Trim the return value to max. 33 characters.
    return returnValue.length > 33 ? returnValue.slice(0, 30) + '...' : returnValue;
  };

  /**
   * Helper function to copy text to clipboard with auto-clear
   */
  const copyToClipboard = async (text: string): Promise<void> => {
    try {
      // Get clipboard clear timeout from settings
      const timeoutSeconds = await LocalPreferencesService.getClipboardClearTimeout();

      // Use centralized clipboard utility
      await copyToClipboardWithExpiration(text, timeoutSeconds);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  /**
   * Handles the context menu action when an item is selected.
   * @param event - The event object containing the selected action details
   */
  const handleContextMenuAction = async (event: NativeSyntheticEvent<ContextMenuOnPressNativeEvent>): Promise<void> => {
    const { name } = event.nativeEvent;

    switch (name) {
      case t('items.contextMenu.edit'):
        Keyboard.dismiss();
        router.push({
          pathname: '/(tabs)/items/add-edit',
          params: { id: item.Id }
        });
        break;
      case t('items.contextMenu.delete'):
        Keyboard.dismiss();
        showConfirm(
          t('items.deleteItem'),
          t('items.deleteConfirm'),
          t('common.delete'),
          async () => {
            if (onItemDelete) {
              await onItemDelete(item.Id);
            }
          },
          { confirmStyle: 'destructive' }
        );
        break;
      case t('items.contextMenu.copyUsername'):
        {
          const username = getFieldValue(item, FieldKey.LoginUsername);
          if (username) {
            await copyToClipboard(username);
            if (Platform.OS === 'ios') {
              Toast.show({
                type: 'success',
                text1: t('items.toasts.usernameCopied'),
                position: 'bottom',
              });
            }
          }
        }
        break;
      case t('items.contextMenu.copyEmail'):
        {
          const email = getFieldValue(item, FieldKey.LoginEmail);
          if (email) {
            await copyToClipboard(email);
            if (Platform.OS === 'ios') {
              Toast.show({
                type: 'success',
                text1: t('items.toasts.emailCopied'),
                position: 'bottom',
              });
            }
          }
        }
        break;
      case t('items.contextMenu.copyPassword'):
        {
          const password = getFieldValue(item, FieldKey.LoginPassword);
          if (password) {
            await copyToClipboard(password);
            if (Platform.OS === 'ios') {
              Toast.show({
                type: 'success',
                text1: t('items.toasts.passwordCopied'),
                position: 'bottom',
              });
            }
          }
        }
        break;
    }
  };

  /**
   * Gets the menu actions for the context menu based on available item data.
   * @returns Array of menu action objects with title and icon
   */
  const getMenuActions = (): {
    title: string;
    systemIcon: string;
    destructive?: boolean;
  }[] => {
    const actions: { title: string; systemIcon: string; destructive?: boolean }[] = [
      {
        title: t('items.contextMenu.edit'),
        systemIcon: Platform.select({
          ios: 'pencil',
          android: 'baseline_edit',
          default: 'pencil',
        }),
      },
      {
        title: t('items.contextMenu.delete'),
        systemIcon: Platform.select({
          ios: 'trash',
          android: 'baseline_delete',
          default: 'trash',
        }),
        destructive: true,
      },
    ];

    const username = getFieldValue(item, FieldKey.LoginUsername);
    if (username) {
      actions.push({
        title: t('items.contextMenu.copyUsername'),
        systemIcon: Platform.select({
          ios: 'person',
          android: 'baseline_person',
          default: 'person',
        }),
      });
    }

    const email = getFieldValue(item, FieldKey.LoginEmail);
    if (email) {
      actions.push({
        title: t('items.contextMenu.copyEmail'),
        systemIcon: Platform.select({
          ios: 'envelope',
          android: 'baseline_email',
          default: 'envelope',
        }),
      });
    }

    const password = getFieldValue(item, FieldKey.LoginPassword);
    if (password) {
      actions.push({
        title: t('items.contextMenu.copyPassword'),
        systemIcon: Platform.select({
          ios: 'key',
          android: 'baseline_key',
          default: 'key',
        }),
      });
    }

    return actions;
  };

  const styles = StyleSheet.create({
    credentialCard: {
      backgroundColor: colors.accentBackground,
      borderRadius: 8,
      marginBottom: 8,
      padding: 12,
    },
    itemContent: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    itemInfo: {
      flex: 1,
    },
    itemText: {
      color: colors.textMuted,
      fontSize: 14,
    },
    iconStyle: {
      marginLeft: 6,
    },
    logo: {
      borderRadius: 4,
      height: 32,
      marginRight: 12,
      width: 32,
    },
    serviceName: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 4,
    },
    serviceNameRow: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    folderPath: {
      color: colors.textMuted,
      fontSize: 14,
    },
  });

  return (
    <ContextMenu
      title={t('items.contextMenu.title')}
      actions={getMenuActions()}
      onPress={handleContextMenuAction}
      previewBackgroundColor={colors.accentBackground}
    >
        <TouchableOpacity
          style={styles.credentialCard}
          onPress={() => {
            Keyboard.dismiss();
            router.push(`/(tabs)/items/${item.Id}`);
          }}
          onLongPress={() => {
            // Ignore long press to prevent context menu long press from triggering the item card press.
          }}
          activeOpacity={0.7}
          testID="item-card"
          accessibilityLabel={item.Name}
        >
          <View style={styles.itemContent}>
            <ItemIcon item={item} style={styles.logo} />
            <View style={styles.itemInfo}>
              <View style={styles.serviceNameRow}>
                {showFolderPath && item.FolderPath && (
                  <Text style={styles.folderPath}>{item.FolderPath} &gt; </Text>
                )}
                <Text style={styles.serviceName}>
                  {getItemName(item)}
                </Text>
                {item.HasPasskey && (
                  <MaterialIcons
                    name="vpn-key"
                    size={14}
                    color={colors.textMuted}
                    style={styles.iconStyle}
                  />
                )}
                {item.HasAttachment && (
                  <MaterialIcons
                    name="attach-file"
                    size={14}
                    color={colors.textMuted}
                    style={styles.iconStyle}
                  />
                )}
                {item.HasTotp && (
                  <MaterialIcons
                    name="pin"
                    size={14}
                    color={colors.textMuted}
                    style={styles.iconStyle}
                  />
                )}
              </View>
              <Text style={styles.itemText}>
                {getItemDisplayText(item)}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
    </ContextMenu>
  );
}
