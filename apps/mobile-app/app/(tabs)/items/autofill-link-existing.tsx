import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Platform, StyleSheet, TextInput, TouchableOpacity, View, type ListRenderItem } from 'react-native';
import Toast from 'react-native-toast-message';

import type { Item, ItemField } from '@/utils/dist/core/models/vault';
import {
  FieldKey,
  FieldTypes,
  ItemTypes,
  getFieldValue,
  getFieldValues,
} from '@/utils/dist/core/models/vault';

import { useColors } from '@/hooks/useColorScheme';
import { useVaultMutate } from '@/hooks/useVaultMutate';

import { ItemIcon } from '@/components/items/ItemIcon';
import { ThemedSafeAreaView } from '@/components/themed/ThemedSafeAreaView';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { useDb } from '@/context/DbContext';
import { useDialog } from '@/context/DialogContext';

/**
 * Screen for picking an existing credential to attach the autofill
 * URL/package identifier to. After saving, the user is navigated to a
 * confirmation screen so they know the link was created and that the
 * next autofill attempt for the same app should succeed.
 */
export default function AutofillLinkExistingScreen(): React.ReactNode {
  const router = useRouter();
  const navigation = useNavigation();
  const colors = useColors();
  const { t } = useTranslation();
  const dbContext = useDb();
  const { executeVaultMutation } = useVaultMutate();
  const { showConfirm } = useDialog();
  const { itemUrl } = useLocalSearchParams<{ itemUrl?: string }>();

  const decodedAppInfo = useMemo(() => {
    if (!itemUrl) {
      return '';
    }
    try {
      return decodeURIComponent(itemUrl);
    } catch {
      return itemUrl;
    }
  }, [itemUrl]);

  const [items, setItems] = useState<Item[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  /**
   * Load Login-typed items from the local vault. We don't need credit
   * cards / notes here because the URL field only applies to logins.
   */
  useEffect(() => {
    /**
     * Fetch login items from the vault.
     */
    const load = async (): Promise<void> => {
      try {
        const all = await dbContext.sqliteClient!.items.getAll();
        const logins = all.filter(item => item.ItemType === ItemTypes.Login);
        setItems(logins);
      } catch (err) {
        console.error('Error loading items for autofill link flow:', err);
      }
    };
    if (dbContext.dbAvailable) {
      load();
    }
  }, [dbContext.dbAvailable, dbContext.sqliteClient]);

  /**
   * Header title — back navigation is handled by the stack's default
   * back arrow, so we don't need a custom right-side button here.
   */
  useEffect(() => {
    navigation.setOptions({
      title: t('items.autofillLinkExisting.title'),
    });
  }, [navigation, t]);

  /**
   * Filter items using a substring match across name, username, email,
   * and any of the credential's existing URLs (multi-value aware).
   */
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return items;
    }
    const words = q.split(/\s+/).filter(Boolean);
    return items.filter(item => {
      const haystacks: string[] = [
        item.Name?.toLowerCase() ?? '',
        getFieldValue(item, FieldKey.LoginUsername)?.toLowerCase() ?? '',
        getFieldValue(item, FieldKey.LoginEmail)?.toLowerCase() ?? '',
        ...getFieldValues(item, FieldKey.LoginUrl).map(u => u.toLowerCase()),
      ];
      return words.every(word => haystacks.some(h => h.includes(word)));
    });
  }, [items, searchQuery]);

  /**
   * Append the autofill URL/package to the chosen item's `login.url`
   * multi-value field and persist via the vault mutation pipeline.
   */
  const linkItem = useCallback(async (item: Item): Promise<void> => {
    if (!decodedAppInfo) {
      return;
    }
    setIsSaving(true);
    try {
      const existingField = item.Fields.find(f => f.FieldKey === FieldKey.LoginUrl);
      const existingValues = existingField
        ? Array.isArray(existingField.Value) ? existingField.Value : [existingField.Value]
        : [];

      /**
       * After a successful link the user shouldn't be able to swipe/back
       * their way into the "what would you like to do?" screen — they're
       * done. Pop everything in the items stack so the success screen
       * sits directly on top of the items home.
       */
      const navigateToSuccess = (): void => {
        router.dismissTo('/(tabs)/items');
        router.push({
          pathname: '/(tabs)/items/autofill-url-added',
          params: { itemName: item.Name ?? '', itemUrl: decodedAppInfo },
        });
      };

      /*
       * Avoid duplicates — if the URL is already linked, skip the write
       * and just send the user to the confirmation screen.
       */
      if (existingValues.includes(decodedAppInfo)) {
        navigateToSuccess();
        return;
      }

      const newValues = [...existingValues.filter(v => v && v.length > 0), decodedAppInfo];

      let updatedFields: ItemField[];
      if (existingField) {
        updatedFields = item.Fields.map(f =>
          f.FieldKey === FieldKey.LoginUrl ? { ...f, Value: newValues } : f
        );
      } else {
        const newField: ItemField = {
          FieldKey: FieldKey.LoginUrl,
          Label: FieldKey.LoginUrl,
          FieldType: FieldTypes.URL,
          Value: newValues,
          IsHidden: false,
          DisplayOrder: 100,
          IsCustomField: false,
          EnableHistory: false,
        };
        updatedFields = [...item.Fields, newField];
      }

      const itemToSave: Item = {
        ...item,
        Fields: updatedFields,
        UpdatedAt: new Date().toISOString(),
      };

      await executeVaultMutation(async () => {
        await dbContext.sqliteClient!.items.update(itemToSave);
      });

      navigateToSuccess();
    } catch (err) {
      console.error('Error linking URL to existing item:', err);
      Toast.show({
        type: 'error',
        text1: t('common.error'),
        text2: t('common.errors.unknownErrorTryAgain'),
      });
    } finally {
      setIsSaving(false);
    }
  }, [decodedAppInfo, dbContext.sqliteClient, executeVaultMutation, router, t]);

  /**
   * Confirm with the user before mutating the credential.
   */
  const handleSelectItem = useCallback((item: Item) => {
    if (isSaving) {
      return;
    }
    showConfirm(
      t('items.autofillLinkExisting.confirmTitle'),
      t('items.autofillLinkExisting.confirmMessage', {
        url: decodedAppInfo,
        name: item.Name ?? t('items.untitled'),
      }),
      t('common.confirm'),
      () => linkItem(item),
    );
  }, [decodedAppInfo, linkItem, showConfirm, t, isSaving]);

  const styles = StyleSheet.create({
    container: {
      flex: 1,
    },
    emptyState: {
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingVertical: 40,
    },
    emptyText: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
    },
    headerArea: {
      paddingBottom: 8,
      paddingHorizontal: 16,
      paddingTop: 12,
    },
    introText: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 20,
      marginBottom: 12,
    },
    itemDetail: {
      color: colors.textMuted,
      fontSize: 13,
      marginTop: 2,
    },
    itemName: {
      fontSize: 16,
      fontWeight: '600',
    },
    itemRow: {
      alignItems: 'center',
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 10,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 12,
      marginHorizontal: 16,
      marginVertical: 4,
      padding: 12,
    },
    itemTextWrapper: {
      flex: 1,
    },
    listContent: {
      paddingBottom: 32,
    },
    searchClearButton: {
      padding: 4,
      position: 'absolute',
      right: 8,
      top: 4,
    },
    searchClearText: {
      color: colors.textMuted,
      fontSize: 20,
    },
    searchContainer: {
      marginTop: 12,
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
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      color: colors.text,
      fontSize: 16,
      height: 40,
      paddingLeft: 40,
      paddingRight: Platform.OS === 'android' ? 40 : 12,
    },
  });

  /**
   * Render an individual credential row.
   */
  const renderItem: ListRenderItem<Item> = useCallback((info) => {
    const row = info.item;
    const username = getFieldValue(row, FieldKey.LoginUsername);
    const email = getFieldValue(row, FieldKey.LoginEmail);
    const detail = username || email || '';

    return (
      <RobustPressable
        style={styles.itemRow}
        onPress={() => handleSelectItem(row)}
        testID={`autofill-link-item-${row.Id}`}
      >
        <ItemIcon item={row} />
        <View style={styles.itemTextWrapper}>
          <ThemedText style={styles.itemName} numberOfLines={1}>
            {row.Name || t('items.untitled')}
          </ThemedText>
          {detail.length > 0 && (
            <ThemedText style={styles.itemDetail} numberOfLines={1}>
              {detail}
            </ThemedText>
          )}
        </View>
        <MaterialIcons name="add-link" size={22} color={colors.primary} />
      </RobustPressable>
    );
  }, [colors.primary, handleSelectItem, styles, t]);

  return (
    <ThemedSafeAreaView style={styles.container}>
      <ThemedView style={styles.headerArea}>
        <ThemedText style={styles.introText}>
          {t('items.autofillLinkExisting.intro', { target: decodedAppInfo })}
        </ThemedText>

        <View style={styles.searchContainer}>
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
            onChangeText={setSearchQuery}
            clearButtonMode={Platform.OS === 'ios' ? 'while-editing' : 'never'}
            testID="autofill-link-search"
          />
          {Platform.OS === 'android' && searchQuery.length > 0 && (
            <TouchableOpacity
              style={styles.searchClearButton}
              onPress={() => setSearchQuery('')}
              testID="autofill-link-clear-search"
            >
              <ThemedText style={styles.searchClearText}>×</ThemedText>
            </TouchableOpacity>
          )}
        </View>
      </ThemedView>

      <FlatList
        data={filteredItems}
        keyExtractor={item => item.Id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={(
          <View style={styles.emptyState}>
            <ThemedText style={styles.emptyText}>
              {searchQuery
                ? t('items.noMatchingItemsSearch', { search: searchQuery })
                : t('items.noItemsFound')}
            </ThemedText>
          </View>
        )}
      />
    </ThemedSafeAreaView>
  );
}
