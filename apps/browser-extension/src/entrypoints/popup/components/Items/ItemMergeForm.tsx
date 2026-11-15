import { scopedKey, type ItemRef } from '@aliasvault/client/database/ItemRef';
import { MergeConflictKeys, planMerge, suggestTarget, type MergeChoice, type MergeChoices, type MergeConflict, type MergeSide } from '@aliasvault/client/items/ItemMerge';
import { toRelativeDisplayFormat } from '@aliasvault/client/utilities/DateHelpers';
import { getItemAccountLabel, type ItemType } from '@aliasvault/models/vault';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Alert from '@/entrypoints/popup/components/Alert';
import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';
import Icon from '@/entrypoints/popup/components/Icons/Icon';
import ItemIcon from '@/entrypoints/popup/components/Items/ItemIcon';
import ItemUrlLine from '@/entrypoints/popup/components/Items/ItemUrlLine';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useVaultMutate } from '@/entrypoints/popup/hooks/useVaultMutate';

import { logFailure } from '@/utils/Diagnostics';

type ItemMergeFormProps = {
  items: [ItemRef, ItemRef];
  onClose: () => void;
  onMerged: (item: ItemRef) => void;
  variant?: 'modal' | 'inline';
};

/**
 * The key of an item side.
 */
function keyOf(side: MergeSide): string {
  return scopedKey(side.item.ManifestId, side.item.Id);
}

/**
 * Merge two items: pick the item to keep, then the value to keep for every field both fill differently.
 */
const ItemMergeForm: React.FC<ItemMergeFormProps> = ({ items, onClose, onMerged, variant = 'modal' }) => {
  const { t, i18n } = useTranslation();
  const dbContext = useDb();
  const { executeVaultMutationAsync } = useVaultMutate();
  const [isMerging, setIsMerging] = useState(false);
  const [revealed, setRevealed] = useState<string[]>([]);

  const sides = useMemo(() => items.map(ref => dbContext.sqliteClient?.items.getMergeSide(ref) ?? null), [dbContext.sqliteClient, items]);
  const [first, second] = sides;
  const [targetKey, setTargetKey] = useState<string | null>(() => (first && second ? keyOf(suggestTarget(first, second)) : null));
  const [picks, setPicks] = useState<Record<string, string>>({});

  if (!first || !second || !targetKey) {
    return null;
  }

  const target = keyOf(first) === targetKey ? first : second;
  const source = target === first ? second : first;
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
   * A stored date-time as a relative time in the UI language, e.g. "3 days ago".
   */
  const relativeTime = (value: string): string => toRelativeDisplayFormat(value, i18n.language);

  /**
   * Save the merge.
   */
  const merge = async (): Promise<void> => {
    if (isMerging || plan.blocker) {
      return;
    }
    setIsMerging(true);
    const targetRef = { Id: target.item.Id, ManifestId: target.item.ManifestId };
    try {
      await executeVaultMutationAsync(async () => {
        await dbContext.sqliteClient!.items.merge(targetRef, { Id: source.item.Id, ManifestId: source.item.ManifestId }, choices);
      });
      onMerged(targetRef);
    } catch (error) {
      logFailure('Error merging items', error);
      setIsMerging(false);
    }
  };

  /**
   * One of the two values a conflict row offers, as a toggle button.
   */
  const renderOption = (conflict: MergeConflict, pick: string, label: string, value: string): React.ReactNode => {
    const choice = pick === targetKey ? 'target' : 'source';
    const isChosen = choiceOf(conflict) === choice;
    const masked = conflict.isHidden && !revealed.includes(conflict.key);
    return (
      <button
        key={pick}
        id={`merge-choice-${conflict.key}-${choice}`}
        type="button"
        onClick={() => setPicks({ ...picks, [conflict.key]: pick })}
        aria-pressed={isChosen}
        className={`flex-1 min-w-0 text-left px-2 py-1.5 rounded-md border text-sm ${isChosen ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10 text-gray-900 dark:text-white' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
      >
        {label && <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">{label}</span>}
        <span className="block truncate">{masked ? '••••••••' : value}</span>
      </button>
    );
  };

  const actions = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} disabled={isMerging} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
        {t('common.cancel')}
      </button>
      {!plan.blocker && (
        <button id="merge-confirm" type="button" onClick={() => void merge()} disabled={isMerging} className="px-4 py-2 text-sm text-white rounded bg-primary-500 hover:bg-primary-600 disabled:opacity-50">
          {t('items.merge.action')}
        </button>
      )}
    </div>
  );

  const body = plan.blocker ? (
    <Alert variant="warning" icon>
      {plan.blocker === 'type' ? t('items.merge.differentTypes', { types: [first, second].map(side => typeName(side.item.ItemType)).join(', ') }) : t('items.merge.differentFolders')}
    </Alert>
  ) : (
    <div className="space-y-4 text-sm">
      <fieldset className="min-w-0">
        <legend className="mb-2 font-medium text-gray-900 dark:text-white">{t('items.merge.keep')}</legend>
        <div className="space-y-2">
          {[first, second].map(side => {
            const isKept = keyOf(side) === targetKey;
            return (
              <label key={keyOf(side)} className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer ${isKept ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                <input type="radio" name="merge-keep" checked={isKept} onChange={() => setTargetKey(keyOf(side))} className="accent-primary-500" />
                <ItemIcon item={side.item} className="w-6 h-6 flex-shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-gray-900 dark:text-white">{side.item.Name || t('items.untitled')}</span>
                  <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{getItemAccountLabel(side.item)}</span>
                  <ItemUrlLine item={side.item} className="text-xs" />
                  <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                    {t('items.merge.lastChanged', { time: relativeTime(side.lastChangedAt) })} · {t('items.merge.lastUsed', { time: side.lastUsedAt ? relativeTime(side.lastUsedAt) : t('common.never') })}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {plan.conflicts.length > 0 && (
        <div>
          <p className="mb-2 text-gray-700 dark:text-gray-300">{t('items.merge.chooseValues')}</p>
          <div className="space-y-3">
            {plan.conflicts.map(conflict => (
              <div key={conflict.key}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{conflictLabel(conflict)}</span>
                  {conflict.isHidden && (
                    <button
                      type="button"
                      onClick={() => setRevealed(revealed.includes(conflict.key) ? revealed.filter(key => key !== conflict.key) : [...revealed, conflict.key])}
                      title={revealed.includes(conflict.key) ? t('common.hidePassword') : t('common.showPassword')}
                      className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    >
                      <Icon name={revealed.includes(conflict.key) ? 'eye-off' : 'eye'} className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  {renderOption(conflict, keyOf(target), conflict.key === MergeConflictKeys.Name ? '' : target.item.Name || t('items.untitled'), conflict.target)}
                  {renderOption(conflict, keyOf(source), conflict.key === MergeConflictKeys.Name ? '' : source.item.Name || t('items.untitled'), conflict.source)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-gray-500 dark:text-gray-400">{t('items.merge.combined')}</p>
    </div>
  );

  if (variant === 'inline') {
    return (
      <div className="space-y-4">
        {body}
        {actions}
      </div>
    );
  }

  return (
    <ModalWrapper isOpen onClose={() => !isMerging && onClose()} title={t('items.merge.title')} bodyClassName="px-4 py-4" footer={actions}>
      {body}
    </ModalWrapper>
  );
};

export default ItemMergeForm;
