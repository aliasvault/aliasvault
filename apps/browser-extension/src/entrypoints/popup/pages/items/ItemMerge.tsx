import { scopedKey, type ItemRef } from '@aliasvault/client/database/ItemRef';
import { truncateFolderPath } from '@aliasvault/client/items/FolderUtils';
import { applySearchFilter } from '@aliasvault/client/items/ItemFilters';
import { mergeBlocker } from '@aliasvault/client/items/ItemMerge';
import { suggestMergeCandidates } from '@aliasvault/client/items/MergeSuggestions';
import { FieldKey } from '@aliasvault/models/vault';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import Icon from '@/entrypoints/popup/components/Icons/Icon';
import ItemCard from '@/entrypoints/popup/components/Items/ItemCard';
import ItemIcon from '@/entrypoints/popup/components/Items/ItemIcon';
import ItemMergeForm from '@/entrypoints/popup/components/Items/ItemMergeForm';
import ItemUrlLine from '@/entrypoints/popup/components/Items/ItemUrlLine';
import PageTitle from '@/entrypoints/popup/components/PageTitle';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useItemBackButtonTitle } from '@/entrypoints/popup/hooks/useItemBackButtonTitle';
import { useRootDomains } from '@/entrypoints/popup/hooks/useRootDomains';

import { itemRoute } from '@/utils/ItemRoute';

import type { Item } from '@aliasvault/models/vault';

const PAGE_SIZE = 50;

/**
 * The item being merged, shown above the picker like a list card for comparison.
 */
const BaseItemCard: React.FC<{ item: Item }> = ({ item }) => {
  const { t } = useTranslation();
  const value = [FieldKey.LoginUsername, FieldKey.LoginEmail].map(key => item.Fields.find(field => field.FieldKey === key)?.Value).find(entry => (Array.isArray(entry) ? entry[0] : entry));
  const subtitle = Array.isArray(value) ? value[0] : value;
  return (
    <div id="merge-base" className="p-2 flex items-center gap-2 rounded border border-primary-500 dark:border-primary-400 bg-primary-50 dark:bg-primary-500/10">
      <ItemIcon item={item} className="w-8 h-8 flex-shrink-0" />
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
    </div>
  );
};

/**
 * Merge an item with another one: search the other item, then choose what the merged item keeps.
 */
const ItemMerge: React.FC = () => {
  const { t } = useTranslation();
  const { id, manifestId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const dbContext = useDb();
  const { setIsInitialLoading } = useLoading();
  const [search, setSearch] = useState('');
  const [shownCount, setShownCount] = useState(PAGE_SIZE);

  const item = useMemo(() => (id && manifestId ? dbContext.sqliteClient?.items.getById({ Id: id, ManifestId: manifestId }) ?? null : null), [dbContext.sqliteClient, id, manifestId]);
  const candidates = useMemo(() => {
    const all = item ? dbContext.sqliteClient?.items.getAll() ?? [] : [];
    return all.filter(other => item && mergeBlocker(item, other) === null).sort((a, b) => (a.Name ?? '').localeCompare(b.Name ?? ''));
  }, [dbContext.sqliteClient, item]);
  const resolvable = useMemo(() => (item ? [item, ...candidates] : []), [item, candidates]);
  const rootDomains = useRootDomains(resolvable);

  const suggested = useMemo(() => (item && rootDomains ? suggestMergeCandidates(item, candidates, url => rootDomains.get(url) ?? null) : null), [item, candidates, rootDomains]);
  const results = useMemo(() => (search ? applySearchFilter(candidates, search) : candidates.filter(candidate => !suggested?.includes(candidate))), [candidates, search, suggested]);

  // Items to merge (when picked)
  const otherId = searchParams.get('otherId');
  const otherManifestId = searchParams.get('otherManifestId');
  const pair = useMemo((): [ItemRef, ItemRef] | null => (item && otherId && otherManifestId ? [item, { Id: otherId, ManifestId: otherManifestId }] : null), [item, otherId, otherManifestId]);

  useItemBackButtonTitle(item);

  useEffect(() => {
    setIsInitialLoading(false);
    if (!item) {
      navigate('/items', { replace: true });
    }
  }, [item, navigate, setIsInitialLoading]);

  if (!item) {
    return null;
  }

  /**
   * Go to the second step with the picked item.
   */
  const pick = (other: Item): void => setSearchParams({ otherManifestId: other.ManifestId, otherId: other.Id }, { replace: true });

  /**
   * The heading of a part of the picker.
   */
  const renderHeading = (text: string): React.ReactNode => <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{text}</h2>;

  /**
   * A list of items to pick from.
   */
  const renderList = (items: Item[]): React.ReactNode => (
    <ul className="space-y-1">
      {items.map(candidate => <ItemCard key={scopedKey(candidate.ManifestId, candidate.Id)} item={candidate} showFolderPath showUrl onClick={pick} />)}
    </ul>
  );

  return (
    <div className="space-y-4">
      <PageTitle>{t('items.merge.title')}</PageTitle>

      {pair ? (
        <ItemMergeForm
          variant="inline"
          items={pair}
          onClose={() => setSearchParams({}, { replace: true })}
          onMerged={target => navigate(itemRoute(target), { replace: true })}
        />
      ) : (
        <>
          <div className="space-y-3">
            <BaseItemCard item={item} />
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
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('items.searchPlaceholder')}
              autoFocus
              className="w-full p-2 border dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          {!search && (
            <section id="merge-suggestions">
              {renderHeading(t('items.suggestions'))}
              {suggested === null && <p className="text-sm text-gray-500 dark:text-gray-400">{t('common.loading')}</p>}
              {suggested?.length === 0 && (
                <p id="merge-no-suggestions" className="px-3 py-2 text-sm rounded-md border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400">
                  {t('items.merge.noSuggestions')}
                </p>
              )}
              {suggested && suggested.length > 0 && renderList(suggested)}
            </section>
          )}

          <section id="merge-items">
            {!search && results.length > 0 && renderHeading(t('items.title'))}
            {renderList(results.slice(0, shownCount))}
            {search && results.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">{t('items.noMatchingItemsSearch', { search })}</p>}
            {results.length > shownCount && (
              <button type="button" onClick={() => setShownCount(shownCount + PAGE_SIZE)} className="mt-2 w-full py-2 text-sm text-primary-600 dark:text-primary-400 hover:underline">
                {t('common.loadMore')}
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default ItemMerge;
