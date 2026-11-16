import { scopedKey, type ItemRef } from '@aliasvault/client/database/ItemRef';
import { MergeConflictKeys, planMerge, suggestTarget, type MergeChoice, type MergeChoices, type MergeConflict } from '@aliasvault/client/items/ItemMerge';
import { toRelativeDisplayFormat } from '@aliasvault/client/utilities/DateHelpers';
import { getItemAccountLabel, type ItemType } from '@aliasvault/models/vault';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { DisplayMergeSide } from '@/utils/DisplayItem';
import emitter, { type ItemChangedEvent } from '@/utils/EventEmitter';
import { HapticsUtility } from '@/utils/HapticsUtility';

import { useColors } from '@/hooks/useColorScheme';
import { useVaultMutate } from '@/hooks/useVaultMutate';

import { ItemIcon } from '@/components/items/ItemIcon';
import { ItemUrlLine } from '@/components/items/ItemUrlLine';
import { useDb } from '@/context/DbContext';

type ItemMergeFormProps = {
  items: [ItemRef, ItemRef];
  onClose: () => void;
  onMerged: (item: ItemRef) => void;
};

/**
 * The key of an item side.
 */
function keyOf(side: DisplayMergeSide): string {
  return scopedKey(side.item.ManifestId, side.item.Id);
}

/**
 * Merge two items: pick the item to keep, then the value to keep for every field both fill differently.
 */
export function ItemMergeForm({ items, onClose, onMerged }: ItemMergeFormProps): React.ReactNode {
  const { t } = useTranslation();
  const colors = useColors();
  const dbContext = useDb();
  const { executeVaultMutation } = useVaultMutate();
  const [sides, setSides] = useState<[DisplayMergeSide, DisplayMergeSide] | null>(null);
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<string[]>([]);
  const [isMerging, setIsMerging] = useState(false);
  const [first, second] = items;

  useEffect(() => {
    let cancelled = false;
    /**
     * Read both items with the child rows a merge moves.
     */
    const load = async (): Promise<void> => {
      const loaded = await Promise.all([dbContext.sqliteClient!.items.getMergeSide(first), dbContext.sqliteClient!.items.getMergeSide(second)]);
      if (cancelled) {
        return;
      }
      const [a, b] = loaded;
      if (!a || !b) {
        onClose();
        return;
      }
      const suggested = suggestTarget(a, b).item;
      setSides([a, b]);
      setTargetKey(scopedKey(suggested.ManifestId, suggested.Id));
      setPicks({});
    };
    load().catch(error => console.error('Error loading the items to merge:', error));
    return (): void => {
      cancelled = true;
    };
  }, [dbContext.sqliteClient, first, second, onClose]);

  const styles = StyleSheet.create({
    actions: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 8,
    },
    blocker: {
      backgroundColor: colors.warningBackground,
      borderColor: colors.warning,
      borderRadius: 8,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 8,
      padding: 12,
    },
    blockerText: {
      color: colors.text,
      flex: 1,
      fontSize: 14,
      lineHeight: 20,
    },
    button: {
      alignItems: 'center',
      borderRadius: 8,
      flex: 1,
      justifyContent: 'center',
      minHeight: 44,
      paddingHorizontal: 16,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    cancelButton: {
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderWidth: 1,
    },
    cancelText: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '500',
    },
    conflict: {
      gap: 6,
    },
    conflictHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      minHeight: 24,
    },
    conflictLabel: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
    },
    container: {
      gap: 20,
    },
    hint: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 20,
    },
    keepIcon: {
      height: 28,
      width: 28,
    },
    keepInfo: {
      flex: 1,
      gap: 1,
    },
    keepRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10,
    },
    keepName: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
    mergeButton: {
      backgroundColor: colors.primary,
    },
    mergeText: {
      color: colors.primarySurfaceText,
      fontSize: 16,
      fontWeight: '600',
    },
    muted: {
      color: colors.textMuted,
      fontSize: 13,
    },
    option: {
      backgroundColor: colors.accentBackground,
      borderColor: colors.accentBorder,
      borderRadius: 8,
      borderWidth: 1,
      flex: 1,
      minHeight: 44,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    optionChosen: {
      backgroundColor: colors.selectedRowBackground,
      borderColor: colors.primary,
    },
    optionLabel: {
      color: colors.textMuted,
      fontSize: 12,
    },
    optionValue: {
      color: colors.text,
      fontSize: 15,
    },
    options: {
      flexDirection: 'row',
      gap: 8,
    },
    revealButton: {
      paddingHorizontal: 4,
    },
    section: {
      gap: 8,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
  });

  if (!sides || !targetKey) {
    return <ActivityIndicator style={{ marginTop: 24 }} color={colors.primary} />;
  }

  const target = keyOf(sides[0]) === targetKey ? sides[0] : sides[1];
  const source = target === sides[0] ? sides[1] : sides[0];
  const plan = planMerge(target, source);

  /**
   * The choice of a conflict relative to the item being kept.
   */
  const choiceOf = (conflict: MergeConflict): MergeChoice => (picks[conflict.key] ?? targetKey) === targetKey ? 'target' : 'source';
  const choices: MergeChoices = Object.fromEntries(plan.conflicts.map(conflict => [conflict.key, choiceOf(conflict)]));

  /**
   * The label of a conflict row.
   */
  const conflictLabel = (conflict: MergeConflict): string => {
    if (conflict.key === MergeConflictKeys.Name) {
      return t('items.itemName');
    }
    if (conflict.key === MergeConflictKeys.Passkeys) {
      return t('common.passkeys');
    }
    return t(`fieldLabels.${conflict.key}`, { defaultValue: conflict.key });
  };

  /**
   * The translated name of an item type, e.g. `CreditCard` reads `itemTypes.creditCard.title`.
   */
  const typeName = (type: ItemType): string => t(`itemTypes.${type.charAt(0).toLowerCase()}${type.slice(1)}.title`, { defaultValue: type });

  /**
   * A stored date-time as a relative time, e.g. "3 days ago".
   */
  const relativeTime = (value: string): string => toRelativeDisplayFormat(value, t);

  /**
   * Save the merge, then open the kept item.
   */
  const merge = async (): Promise<void> => {
    if (isMerging || plan.blocker) {
      return;
    }
    setIsMerging(true);
    const targetRef = { Id: target.item.Id, ManifestId: target.item.ManifestId };
    const sourceRef = { Id: source.item.Id, ManifestId: source.item.ManifestId };
    let isMerged = false;
    // A failure is logged and shown as a toast by executeVaultMutation.
    await executeVaultMutation(async () => {
      await dbContext.sqliteClient!.items.merge(targetRef, sourceRef, choices);
      isMerged = true;
    });
    if (!isMerged) {
      setIsMerging(false);
      return;
    }
    emitter.emit('itemChanged', { previous: sourceRef } as ItemChangedEvent);
    emitter.emit('itemChanged', { previous: targetRef, current: targetRef } as ItemChangedEvent);
    HapticsUtility.notification(Haptics.NotificationFeedbackType.Success);
    onMerged(targetRef);
  };

  /**
   * One of the two values a conflict row offers, as a toggle button.
   */
  const renderOption = (conflict: MergeConflict, side: DisplayMergeSide, value: string): React.ReactNode => {
    const choice = side === target ? 'target' : 'source';
    const isChosen = choiceOf(conflict) === choice;
    const masked = conflict.isHidden && !revealed.includes(conflict.key);
    return (
      <Pressable
        key={keyOf(side)}
        style={[styles.option, isChosen && styles.optionChosen]}
        onPress={() => setPicks({ ...picks, [conflict.key]: keyOf(side) })}
        accessibilityRole="radio"
        accessibilityState={{ checked: isChosen }}
        testID={`merge-choice-${conflict.key}-${choice}`}
      >
        {conflict.key !== MergeConflictKeys.Name && <Text style={styles.optionLabel} numberOfLines={1}>{side.item.Name || t('items.untitled')}</Text>}
        <Text style={styles.optionValue} numberOfLines={2}>{masked ? '••••••••' : value}</Text>
      </Pressable>
    );
  };

  /**
   * One item of the "Item to keep" choice.
   */
  const renderKeep = (side: DisplayMergeSide): React.ReactNode => {
    const isKept = keyOf(side) === targetKey;
    const accountLabel = getItemAccountLabel(side.item);
    return (
      <Pressable
        key={keyOf(side)}
        style={[styles.option, styles.keepRow, isKept && styles.optionChosen]}
        onPress={() => setTargetKey(keyOf(side))}
        accessibilityRole="radio"
        accessibilityState={{ checked: isKept }}
        testID={`merge-keep-${side.item.Id}`}
      >
        <MaterialIcons name={isKept ? 'radio-button-checked' : 'radio-button-unchecked'} size={22} color={isKept ? colors.primary : colors.textMuted} />
        <ItemIcon item={side.item} style={styles.keepIcon} />
        <View style={styles.keepInfo}>
          <Text style={styles.keepName} numberOfLines={1}>{side.item.Name || t('items.untitled')}</Text>
          {accountLabel ? <Text style={styles.muted} numberOfLines={1}>{accountLabel}</Text> : null}
          <ItemUrlLine item={side.item} />
          <Text style={styles.muted} numberOfLines={2}>
            {t('common.lastChanged', { time: relativeTime(side.lastChangedAt) })} · {t('common.lastUsed', { time: side.lastUsedAt ? relativeTime(side.lastUsedAt) : t('common.never') })}
          </Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      {plan.blocker ? (
        <View style={styles.blocker}>
          <MaterialIcons name="warning-amber" size={20} color={colors.warning} />
          <Text style={styles.blockerText}>
            {plan.blocker === 'type' ? t('items.merge.differentTypes', { types: sides.map(side => typeName(side.item.ItemType)).join(', ') }) : t('items.merge.differentFolders')}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.section} accessibilityRole="radiogroup">
            <Text style={styles.sectionTitle}>{t('items.merge.keep')}</Text>
            {sides.map(renderKeep)}
          </View>

          {plan.conflicts.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.hint}>{t('items.merge.chooseValues')}</Text>
              {plan.conflicts.map(conflict => (
                <View key={conflict.key} style={styles.conflict}>
                  <View style={styles.conflictHeader}>
                    <Text style={styles.conflictLabel}>{conflictLabel(conflict)}</Text>
                    {conflict.isHidden && (
                      <TouchableOpacity
                        style={styles.revealButton}
                        onPress={() => setRevealed(revealed.includes(conflict.key) ? revealed.filter(key => key !== conflict.key) : [...revealed, conflict.key])}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityLabel={revealed.includes(conflict.key) ? t('common.hidePassword') : t('common.showPassword')}
                      >
                        <MaterialIcons name={revealed.includes(conflict.key) ? 'visibility-off' : 'visibility'} size={20} color={colors.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={styles.options} accessibilityRole="radiogroup">
                    {sides.map(side => renderOption(conflict, side, side === target ? conflict.target : conflict.source))}
                  </View>
                </View>
              ))}
            </View>
          )}

          <Text style={styles.hint}>{t('items.merge.combined')}</Text>
        </>
      )}

      <View style={styles.actions}>
        <TouchableOpacity style={[styles.button, styles.cancelButton]} onPress={onClose} disabled={isMerging} testID="merge-cancel">
          <Text style={styles.cancelText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
        {!plan.blocker && (
          <TouchableOpacity style={[styles.button, styles.mergeButton, isMerging && styles.buttonDisabled]} onPress={() => void merge()} disabled={isMerging} testID="merge-confirm">
            {isMerging ? <ActivityIndicator color={colors.primarySurfaceText} /> : <Text style={styles.mergeText}>{t('items.merge.action')}</Text>}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
