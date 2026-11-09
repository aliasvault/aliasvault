/* eslint-disable max-len */
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, Text, Keyboard, Platform, Pressable } from 'react-native';
import ContextMenu, { type ContextMenuAction, ContextMenuOnPressNativeEvent } from 'react-native-context-menu-view';
import type { NativeSyntheticEvent } from 'react-native';
import { toast } from 'sonner-native';

import { SelectableListRow } from '@/components/common/SelectableListRow';
import { ItemIcon } from '@/components/items/ItemIcon';
import { useDialog } from '@/context/DialogContext';
import { useDb } from '@/context/DbContext';
import { LocalPreferencesService } from '@/services/LocalPreferencesService';
import { useColors } from '@/hooks/useColorScheme';
import { useNavigationDebounce } from '@/hooks/useNavigationDebounce';
import { usePaneRouter } from '@/hooks/usePaneRouter';
import { useIsSelectedRoute } from '@/hooks/useTwoPane';
import { useRecordItemCopy } from '@/hooks/useRecordItemCopy';
import { copyToClipboardWithExpiration } from '@/utils/ClipboardUtility';
import type { DisplayItem } from '@/utils/DisplayItem';
import { itemEditRoute, itemRoute } from '@/utils/ItemRoute';
import type { ItemRef } from '@aliasvault/client/database/ItemRef';
import { generateTotpCode } from '@aliasvault/client/items/TotpUtility';
import { getFieldValue, FieldKey } from '@aliasvault/models/vault';

type ItemCardProps = {
  item: DisplayItem;
  onItemDelete?: (item: ItemRef) => Promise<void>;
  onItemDuplicate?: (item: ItemRef) => Promise<void>;
  showFolderPath?: boolean;
  isHighlighted?: boolean;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (item: DisplayItem) => void;
  onSelectFromMenu?: (item: DisplayItem) => void;
};

/**
 * Item card component for displaying vault items in a list.
 */
function ItemCardComponent({ item, onItemDelete, onItemDuplicate, showFolderPath = false, isHighlighted = false, selectionMode = false, isSelected = false, onToggleSelect, onSelectFromMenu }: ItemCardProps): React.ReactNode {
  const colors = useColors();
  const { t } = useTranslation();
  const { showConfirm } = useDialog();
  const dbContext = useDb();
  const navigate = useNavigationDebounce();
  const paneRouter = usePaneRouter();
  const isActive = useIsSelectedRoute(itemRoute(item));
  const recordItemCopy = useRecordItemCopy();

  /**
   * Get the display text for an item, showing username by default,
   * falling back to email only if username is null/undefined/empty
   */
  const getItemDisplayText = (itm: DisplayItem): string => {
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
  const getItemName = (itm: DisplayItem): string => {
    const returnValue = itm.Name || t('items.untitled');

    // Trim the return value to max. 33 characters.
    return returnValue.length > 33 ? returnValue.slice(0, 30) + '...' : returnValue;
  };

  /**
   * Open the item's details.
   */
  const openItem = (): void => {
    navigate(() => {
      Keyboard.dismiss();
      paneRouter.openDetail(itemRoute(item));
    });
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
      recordItemCopy({ Id: item.Id, ManifestId: item.ManifestId });
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
      case t('common.open'):
        openItem();
        break;
      case t('common.select'):
        onSelectFromMenu?.(item);
        break;
      case t('common.edit'):
        navigate(() => {
          Keyboard.dismiss();
          router.push(itemEditRoute(item));
        });
        break;
      case t('common.duplicate'):
        if (onItemDuplicate) {
          await onItemDuplicate({ Id: item.Id, ManifestId: item.ManifestId });
        }
        break;
      case t('common.delete'):
        Keyboard.dismiss();
        showConfirm(
          t('items.deleteItem'),
          t('items.deleteConfirm'),
          t('common.delete'),
          async () => {
            if (onItemDelete) {
              await onItemDelete({ Id: item.Id, ManifestId: item.ManifestId });
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
              toast.success(t('items.toasts.usernameCopied'));
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
              toast.success(t('items.toasts.emailCopied'));
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
              toast.success(t('items.toasts.passwordCopied'));
            }
          }
        }
        break;
      case t('items.contextMenu.copyTotpCode'):
        {
          if (dbContext?.sqliteClient) {
            try {
              const totpCodes = await dbContext.sqliteClient.items.getTotpCodesForItem(item);
              const activeTotp = totpCodes.find(tc => !tc.IsDeleted);
              if (activeTotp) {
                const code = await generateTotpCode(activeTotp.SecretKey, activeTotp);
                if (code) {
                  await copyToClipboard(code);
                  if (Platform.OS === 'ios') {
                    toast.success(t('items.toasts.totpCodeCopied'));
                  }
                }
              }
            } catch (error) {
              console.error('Failed to copy TOTP code:', error);
            }
          }
        }
        break;
    }
  };

  /**
   * The context menu entries, in groups: open and edit, copy, select, delete. iOS draws a separator between groups;
   * the Android menu shows the same entries as one flat list.
   */
  const getMenuActions = (): ContextMenuAction[] => {
    /**
     * A menu entry with its iOS SF Symbol and its Android drawable (generated from core/assets/icons).
     */
    const action = (title: string, ios: string, android?: string, destructive = false): ContextMenuAction => ({
      title,
      ...(Platform.OS === 'ios' ? { systemIcon: ios } : { icon: android }),
      ...(destructive && { destructive: true }),
    });

    const copyActions: ContextMenuAction[] = [];
    if (getFieldValue(item, FieldKey.LoginUsername)) {
      copyActions.push(action(t('items.contextMenu.copyUsername'), 'person', 'ic_ui_user'));
    }
    if (getFieldValue(item, FieldKey.LoginEmail)) {
      copyActions.push(action(t('items.contextMenu.copyEmail'), 'envelope', 'ic_ui_mail'));
    }
    if (getFieldValue(item, FieldKey.LoginPassword)) {
      copyActions.push(action(t('items.contextMenu.copyPassword'), 'key', 'ic_ui_key'));
    }
    if (item.HasTotp) {
      copyActions.push(action(t('items.contextMenu.copyTotpCode'), 'number', 'ic_ui_hashtag'));
    }

    /*
     * On iOS several copy actions fold into one submenu, so the menu stays short enough for the row to stay in place.
     * Android lists them flat: the library adds an Android submenu out of order and puts its icon on another entry.
     */
    const copyGroup = Platform.OS === 'ios' && copyActions.length > 1
      ? [{ ...action(t('common.copyToClipboard'), 'doc.on.doc'), actions: copyActions }]
      : copyActions;

    const groups: ContextMenuAction[][] = [
      [
        action(t('common.open'), 'eye', 'ic_ui_eye'),
        action(t('common.edit'), 'pencil', 'ic_ui_pencil_alt'),
        action(t('common.duplicate'), 'plus.square.on.square', 'ic_ui_document_duplicate'),
      ],
      copyGroup,
      // On Android a long-press already selects, so only iOS gets a Select entry.
      Platform.OS === 'ios' && onSelectFromMenu && !selectionMode ? [action(t('common.select'), 'checkmark.circle')] : [],
      [action(t('common.delete'), 'trash', 'ic_ui_trash', true)],
    ].filter(group => group.length > 0);

    if (Platform.OS === 'ios') {
      return groups.map(group => ({ title: '', inlineChildren: true, actions: group }));
    }
    return groups.flat();
  };

  const styles = StyleSheet.create({
    credentialCard: {
      backgroundColor: colors.accentBackground,
      borderColor: 'transparent',
      borderRadius: 8,
      borderWidth: 2,
      marginBottom: 8,
      padding: 10,
    },
    credentialCardActive: {
      backgroundColor: colors.selectedRowBackground,
    },
    credentialCardHighlighted: {
      borderColor: colors.primary,
    },
    // The menu button covers the right edge of the row: the spacer plus the card's padding and border.
    menuButton: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: 18,
    },
    menuButtonHost: {
      flex: 1,
    },
    menuButtonSpace: {
      width: 44,
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
    <SelectableListRow
      style={[styles.credentialCard, isActive && styles.credentialCardActive, isHighlighted && styles.credentialCardHighlighted]}
      selectionMode={selectionMode}
      isSelected={isSelected}
      onToggleSelect={onToggleSelect ? () => onToggleSelect(item) : undefined}
      onOpen={openItem}
      menu={{ title: t('items.contextMenu.title'), actions: getMenuActions(), onPress: handleContextMenuAction }}
      trailing={Platform.OS === 'android' && !selectionMode && (
        <ContextMenu actions={getMenuActions()} onPress={handleContextMenuAction} dropdownMenuMode style={styles.menuButtonHost}>
          <Pressable style={styles.menuButton} onPress={() => undefined} android_ripple={{ color: colors.accentBorder, borderless: true, radius: 22 }} accessibilityRole="button" accessibilityLabel={t('items.contextMenu.title')}>
            <MaterialIcons name="more-vert" size={20} color={colors.textMuted} />
          </Pressable>
        </ContextMenu>
      )}
      testID="item-card"
      accessibilityLabel={item.Name ?? undefined}
    >
      <View style={styles.itemContent}>
        <ItemIcon item={item} style={styles.logo} />
        <View style={styles.itemInfo}>
          <View style={styles.serviceNameRow}>
            {showFolderPath && item.FolderPath && item.FolderPath.length > 0 && (
              <Text style={styles.folderPath}>{item.FolderPath.join(' > ')} &gt; </Text>
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
        {/* On Android a long-press selects, so the item menu sits behind a button on the row; this keeps its space free. */}
        {Platform.OS === 'android' && !selectionMode && <View style={styles.menuButtonSpace} />}
      </View>
    </SelectableListRow>
  );
}

/** Re-renders only when its own props change, so toggling one row leaves the others alone. */
export const ItemCard = memo(ItemCardComponent);
