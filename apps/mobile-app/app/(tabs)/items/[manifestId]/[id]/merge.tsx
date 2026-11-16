import { scopedKey, type ItemRef } from '@aliasvault/client/database/ItemRef';
import { truncateFolderPath } from '@aliasvault/client/items/FolderUtils';
import { applySearchFilter } from '@aliasvault/client/items/ItemFilters';
import { mergeBlocker } from '@aliasvault/client/items/ItemMerge';
import { suggestMergeCandidates } from '@aliasvault/client/items/MergeSuggestions';
import { getItemAccountLabel } from '@aliasvault/models/vault';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, type ListRenderItem } from 'react-native';

import type { DisplayItem } from '@/utils/DisplayItem';
import { itemRoute } from '@/utils/ItemRoute';

import { useColors } from '@/hooks/useColorScheme';
import { useUrlDomains } from '@/hooks/useUrlDomains';

import { ItemIcon } from '@/components/items/ItemIcon';
import { ItemMergeForm } from '@/components/items/ItemMergeForm';
import { ItemUrlLine } from '@/components/items/ItemUrlLine';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { RobustPressable } from '@/components/ui/RobustPressable';
import { useDb } from '@/context/DbContext';

type MergeParams = { manifestId: string; id: string; otherManifestId?: string; otherId?: string };

/**
 * An item row of the merge screen: icon, folder path and name, account label and first URL.
 */
function MergeItemRow({ item, isBase = false, onPress }: { item: DisplayItem; isBase?: boolean; onPress?: (item: DisplayItem) => void }): React.ReactNode {
  const { t } = useTranslation();
  const colors = useColors();
  const accountLabel = getItemAccountLabel(item);
  const styles = StyleSheet.create({
    folderPath: {
      color: colors.textMuted,
      fontSize: 14,
      fontWeight: 'normal',
    },
    info: {
      flex: 1,
    },
    logo: {
      height: 32,
      width: 32,
    },
    muted: {
      color: colors.textMuted,
      fontSize: 14,
    },
    name: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 2,
    },
    row: {
      alignItems: 'center',
      backgroundColor: isBase ? colors.selectedRowBackground : colors.accentBackground,
      borderColor: isBase ? colors.primary : 'transparent',
      borderRadius: 8,
      borderWidth: 2,
      flexDirection: 'row',
      gap: 12,
      marginBottom: 8,
      padding: 10,
    },
  });

  const content = (
    <>
      <ItemIcon item={item} style={styles.logo} />
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {item.FolderPath && item.FolderPath.length > 0 && <Text style={styles.folderPath}>{truncateFolderPath(item.FolderPath, 3).join(' > ')} &gt; </Text>}
          {item.Name || t('items.untitled')}
        </Text>
        {accountLabel ? <Text style={styles.muted} numberOfLines={1}>{accountLabel}</Text> : null}
        <ItemUrlLine item={item} />
      </View>
    </>
  );

  if (!onPress) {
    return <View style={styles.row} testID="merge-base">{content}</View>;
  }
  return (
    <RobustPressable style={styles.row} onPress={() => onPress(item)} testID={`merge-item-${item.Id}`} accessibilityLabel={item.Name ?? undefined}>
      {content}
    </RobustPressable>
  );
}

/**
 * Merge an item with another one: search the other item, then choose what the merged item keeps.
 */
export default function ItemMergeScreen(): React.ReactNode {
  const { t } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const dbContext = useDb();
  const { manifestId, id, otherManifestId, otherId } = useLocalSearchParams<MergeParams>();
  const [item, setItem] = useState<DisplayItem | null>(null);
  const [allItems, setAllItems] = useState<DisplayItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    /**
     * Load the item to merge and the items it can be merged with.
     */
    const load = async (): Promise<void> => {
      const [base, all] = await Promise.all([dbContext.sqliteClient!.items.getById({ Id: id, ManifestId: manifestId }), dbContext.sqliteClient!.items.getAll()]);
      if (cancelled) {
        return;
      }
      if (!base) {
        router.back();
        return;
      }
      setItem(base);
      setAllItems(all);
      setIsLoading(false);
    };
    load().catch(error => console.error('Error loading items to merge:', error));
    return (): void => {
      cancelled = true;
    };
  }, [dbContext.sqliteClient, id, manifestId, router]);

  const candidates = useMemo(() => {
    if (!item) {
      return [];
    }
    return allItems.filter(other => [null, 'manifest'].includes(mergeBlocker(item, other))).sort((a, b) => (a.Name ?? '').localeCompare(b.Name ?? ''));
  }, [allItems, item]);
  const resolvable = useMemo(() => (item ? [item, ...candidates] : []), [item, candidates]);
  const urlDomains = useUrlDomains(resolvable);
  const suggested = useMemo(() => (item && urlDomains ? suggestMergeCandidates(item, candidates, url => urlDomains.get(url) ?? null) : null), [item, candidates, urlDomains]);
  const results = useMemo(() => (search ? applySearchFilter(candidates, search) : []), [candidates, search]);

  const pair = useMemo((): [ItemRef, ItemRef] | null => (otherId && otherManifestId ? [{ Id: id, ManifestId: manifestId }, { Id: otherId, ManifestId: otherManifestId }] : null), [id, manifestId, otherId, otherManifestId]);

  /**
   * Go to the second step with the picked item; params replace, so no history entry is added.
   */
  const pick = useCallback((other: DisplayItem): void => router.setParams({ otherManifestId: other.ManifestId, otherId: other.Id }), [router]);

  /**
   * Leave the merge form and go back to the picker.
   */
  const closeForm = useCallback((): void => router.setParams({ otherManifestId: undefined, otherId: undefined }), [router]);

  /**
   * Open the kept item in place of this screen.
   */
  const openMerged = useCallback((target: ItemRef): void => router.replace(itemRoute(target)), [router]);

  const styles = StyleSheet.create({
    arrow: {
      alignItems: 'center',
      backgroundColor: colors.selectedRowBackground,
      borderRadius: 14,
      height: 28,
      justifyContent: 'center',
      width: 28,
    },
    arrowLabel: {
      color: colors.textMuted,
      fontSize: 14,
    },
    arrowRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'center',
      marginBottom: 12,
      marginTop: 4,
    },
    hint: {
      color: colors.textMuted,
      fontSize: 14,
      marginBottom: 8,
    },
    listContent: {
      paddingBottom: 32,
      paddingTop: 16,
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
      marginBottom: 16,
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
    sectionTitle: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.5,
      marginBottom: 8,
      textTransform: 'uppercase',
    },
  });

  const renderItem: ListRenderItem<DisplayItem> = useCallback(({ item: candidate }) => <MergeItemRow item={candidate} onPress={pick} />, [pick]);

  if (isLoading || !item) {
    return (
      <ThemedContainer>
        <ActivityIndicator style={{ marginTop: 120 }} color={colors.primary} />
      </ThemedContainer>
    );
  }

  if (pair) {
    return (
      <ThemedContainer>
        <ThemedScrollView>
          <ItemMergeForm items={pair} onClose={closeForm} onMerged={openMerged} />
        </ThemedScrollView>
      </ThemedContainer>
    );
  }

  /**
   * What shows below the search input: the suggestions heading, a hint, or nothing while searching.
   */
  const renderListHeading = (): React.ReactNode => {
    if (search) {
      return null;
    }
    if (suggested?.length === 0) {
      return <Text style={styles.hint} testID="merge-search-hint">{t('items.merge.searchHint')}</Text>;
    }
    return (
      <>
        <Text style={styles.sectionTitle}>{t('common.suggestions.title')}</Text>
        {suggested === null && <Text style={styles.hint}>{t('common.loading')}</Text>}
      </>
    );
  };

  return (
    <ThemedContainer>
      <FlatList
        data={search ? results : suggested ?? []}
        keyExtractor={candidate => scopedKey(candidate.ManifestId, candidate.Id)}
        renderItem={renderItem}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={(
          <>
            <MergeItemRow item={item} isBase />
            <View style={styles.arrowRow}>
              <View style={styles.arrow}>
                <MaterialIcons name="arrow-downward" size={16} color={colors.primary} />
              </View>
              <Text style={styles.arrowLabel}>{t('items.merge.mergeWith')}</Text>
            </View>
            <View style={styles.searchContainer}>
              <MaterialIcons name="search" size={20} color={colors.textMuted} style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder={t('items.searchPlaceholder')}
                placeholderTextColor={colors.textMuted}
                value={search}
                autoCorrect={false}
                autoCapitalize="none"
                onChangeText={setSearch}
                clearButtonMode={Platform.OS === 'ios' ? 'while-editing' : 'never'}
                testID="merge-search"
              />
              {Platform.OS === 'android' && search.length > 0 && (
                <TouchableOpacity style={styles.searchClearButton} onPress={() => setSearch('')} testID="merge-clear-search">
                  <Text style={styles.searchClearText}>×</Text>
                </TouchableOpacity>
              )}
            </View>
            {renderListHeading()}
          </>
        )}
        ListEmptyComponent={search ? <Text style={styles.hint}>{t('items.noMatchingItemsSearch', { search })}</Text> : undefined}
      />
    </ThemedContainer>
  );
}
