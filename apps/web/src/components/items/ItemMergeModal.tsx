import { scopedKey, type ItemRef } from '@aliasvault/client/database/ItemRef';
import { truncateFolderPath } from '@aliasvault/client/items/FolderUtils';
import { applySearchFilter } from '@aliasvault/client/items/ItemFilters';
import { mergeBlocker } from '@aliasvault/client/items/ItemMerge';
import { suggestMergeCandidates } from '@aliasvault/client/items/MergeSuggestions';
import { getItemAccountLabel } from '@aliasvault/models/vault';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ItemIcon from '@/components/items/ItemIcon';
import ItemMergeForm from '@/components/items/ItemMergeForm';
import ItemUrlLine from '@/components/items/ItemUrlLine';
import FormModal from '@/components/shared/FormModal';
import Icon from '@/components/shared/Icon';
import { useDb } from '@/context/DbContext';
import { useUrlDomains } from '@/hooks/useUrlDomains';

import type { Item } from '@aliasvault/models/vault';

const PAGE_SIZE = 50;

type ItemMergeModalProps = {
  item: ItemRef;
  onClose: () => void;
  onMerged: (item: ItemRef) => void;
};

/**
 * Name, badges, account and URL of an item, as the merge picker shows it.
 */
const ItemSummary: React.FC<{ item: Item }> = ({ item }) => {
  const { t } = useTranslation();
  const subtitle = getItemAccountLabel(item);
  return (
    <>
      <ItemIcon item={item} sizeClass="w-9 h-9" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="font-medium text-gray-900 dark:text-white truncate">
            {item.FolderPath && item.FolderPath.length > 0 && <span className="text-sm text-gray-500 dark:text-gray-400">{truncateFolderPath(item.FolderPath, 3).join(' > ')} &gt; </span>}
            {item.Name || t('items.untitled')}
          </p>
          {item.HasPasskey && <Icon name="key" className="w-3.5 h-3.5 flex-shrink-0 text-gray-500 dark:text-gray-400" aria-label={t('items.hasPasskey')} />}
          {item.HasAttachment && <Icon name="paper-clip" className="w-3.5 h-3.5 flex-shrink-0 text-gray-500 dark:text-gray-400" aria-label={t('items.hasAttachments')} />}
          {item.HasTotp && <Icon name="pin-material" className="w-3.5 h-3.5 flex-shrink-0 text-gray-500 dark:text-gray-400" aria-label={t('items.hasTotp')} />}
        </div>
        {subtitle && <p className="text-sm text-gray-600 dark:text-gray-400 truncate">{subtitle}</p>}
        <ItemUrlLine item={item} className="text-xs" />
      </div>
    </>
  );
};

/**
 * Merge an item with another one: search the other item, then choose what the merged item keeps.
 */
const ItemMergeModal: React.FC<ItemMergeModalProps> = ({ item: ref, onClose, onMerged }) => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const [search, setSearch] = useState('');
  const [shownCount, setShownCount] = useState(PAGE_SIZE);
  const [other, setOther] = useState<ItemRef | null>(null);

  const item = useMemo(() => dbContext.sqliteClient?.items.getById(ref) ?? null, [dbContext.sqliteClient, ref]);
  const candidates = useMemo(() => {
    const all = item ? dbContext.sqliteClient?.items.getAll() ?? [] : [];
    return all.filter(candidate => item && [null, 'manifest'].includes(mergeBlocker(item, candidate))).sort((a, b) => (a.Name ?? '').localeCompare(b.Name ?? ''));
  }, [dbContext.sqliteClient, item]);
  const resolvable = useMemo(() => (item ? [item, ...candidates] : []), [item, candidates]);
  const urlDomains = useUrlDomains(resolvable);

  const suggested = useMemo(() => (item && urlDomains ? suggestMergeCandidates(item, candidates, url => urlDomains.get(url) ?? null) : null), [item, candidates, urlDomains]);
  const results = useMemo(() => (search ? applySearchFilter(candidates, search) : []), [candidates, search]);
  const pair = useMemo((): [ItemRef, ItemRef] | null => (item && other ? [item, other] : null), [item, other]);

  if (!item) {
    return null;
  }

  /**
   * The heading of a part of the picker.
   */
  const renderHeading = (text: string): React.ReactNode => <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{text}</h4>;

  /**
   * A list of items to pick from.
   */
  const renderList = (items: Item[]): React.ReactNode => (
    <ul className="space-y-2">
      {items.map(candidate => (
        <li key={scopedKey(candidate.ManifestId, candidate.Id)}>
          <button type="button" onClick={() => setOther({ Id: candidate.Id, ManifestId: candidate.ManifestId })} className="w-full p-3 flex items-center gap-3 text-left rounded-lg border border-gray-200 bg-white hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors">
            <ItemSummary item={candidate} />
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <FormModal isOpen title={t('items.merge.title')} maxWidth="xl" showDefaultFooter={false} submitOnEnter={false} closeOnOverlayClick={!pair} showCloseButton onClose={onClose}>
      {pair ? (
        <ItemMergeForm variant="inline" items={pair} onClose={() => setOther(null)} onMerged={onMerged} />
      ) : (
        <div className="space-y-4 text-left">
          <div className="space-y-3">
            <div id="merge-base" className="p-3 flex items-center gap-3 rounded-lg border border-primary-500 dark:border-primary-400 bg-primary-50 dark:bg-primary-500/10">
              <ItemSummary item={item} />
            </div>
            <div className="flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <span className="flex items-center justify-center w-7 h-7 rounded-full bg-primary-100 text-primary-600 dark:bg-primary-500/20 dark:text-primary-300">
                <Icon name="arrow-narrow-down" className="w-4 h-4" />
              </span>
              {t('items.merge.mergeWith')}
            </div>
            <input
              id="merge-search"
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setShownCount(PAGE_SIZE);
              }}
              placeholder={t('items.searchPlaceholder')}
              autoFocus
              autoComplete="off"
              className="block w-full p-2.5 text-sm rounded-lg border border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400"
            />
          </div>

          <div className="max-h-[45vh] overflow-y-auto overscroll-contain">
            {!search && suggested?.length === 0 && <p id="merge-search-hint" className="text-sm text-gray-500 dark:text-gray-400">{t('items.merge.searchHint')}</p>}
            {!search && suggested?.length !== 0 && (
              <section id="merge-suggestions">
                {renderHeading(t('common.suggestions.title'))}
                {suggested === null ? <p className="text-sm text-gray-500 dark:text-gray-400">{t('common.loading')}</p> : renderList(suggested)}
              </section>
            )}

            {search && (
              <section id="merge-items">
                {renderList(results.slice(0, shownCount))}
                {results.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">{t('items.noMatchingItemsSearch', { search })}</p>}
                {results.length > shownCount && (
                  <button type="button" onClick={() => setShownCount(shownCount + PAGE_SIZE)} className="mt-2 w-full py-2 text-sm text-primary-600 dark:text-primary-400 hover:underline">
                    {t('common.loadMore')}
                  </button>
                )}
              </section>
            )}
          </div>
        </div>
      )}
    </FormModal>
  );
};

export default ItemMergeModal;
