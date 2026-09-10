import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import useCurrentTabInfo from '@/entrypoints/popup/hooks/useCurrentTabInfo';

import type { Item } from '@/utils/dist/core/models/vault';
import { applySearchFilter } from '@/utils/ItemFilters';

import ItemIcon from './ItemIcon';

type CurrentSiteSuggestionProps = {
  items: Item[];
  onSearch: (domain: string) => void;
};

/**
 * CurrentSiteSuggestion
 *
 * Shows a suggestion for the current browser tab's matching item(s) as a shortcut at the top of the
 * items index. Matching uses the same search filter as the search field, so clicking through always
 * lands on exactly the items counted here.
 */
const CurrentSiteSuggestion: React.FC<CurrentSiteSuggestionProps> = ({ items, onSearch }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { getCurrentTabInfo } = useCurrentTabInfo();
  const [domain, setDomain] = useState<string | null>(null);

  // Resolve the current tab domain once on mount.
  useEffect(() => {
    let active = true;
    getCurrentTabInfo().then((result) => {
      if (active) {
        setDomain(result?.domain ?? null);
      }
    });
    return (): void => {
      active = false;
    };
  }, [getCurrentTabInfo]);

  const matches = useMemo(
    () => (domain ? applySearchFilter(items, domain) : []),
    [items, domain]
  );

  if (!domain) {
    return null;
  }

  // Single match: open the item directly on click.
  if (matches.length === 1) {
    const item: Item = matches[0];
    return (
      <button
        onClick={() => navigate(`/items/${item.Id}`)}
        className="w-full mb-4 p-2 flex items-center gap-2 rounded-lg border border-orange-300 dark:border-orange-500/40 bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/30 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 text-left"
      >
        <div className="w-8 h-8 flex-shrink-0">
          <ItemIcon item={item} className="w-8 h-8" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-orange-700 dark:text-orange-300 truncate">
            {t('items.currentSiteMatch', { domain })}
          </p>
          <p className="font-medium text-gray-900 dark:text-white truncate">
            {item.Name || t('items.untitled')}
          </p>
        </div>
        <svg className="w-5 h-5 flex-shrink-0 text-orange-500 dark:text-orange-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    );
  }

  // Multiple matches: search the vault for the domain on click.
  if (matches.length > 1) {
    return (
      <button
        onClick={() => onSearch(domain)}
        className="w-full mb-4 p-2 flex items-center gap-2 rounded-lg border border-orange-300 dark:border-orange-500/40 bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/30 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 text-left"
      >
        <svg className="w-5 h-5 flex-shrink-0 text-orange-500 dark:text-orange-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span className="min-w-0 text-sm flex-1 font-medium text-orange-700 dark:text-orange-300 truncate">
          {domain} ({t('items.numberOfItemMatchesFound', { count: matches.length })})
        </span>
        <svg className="w-5 h-5 flex-shrink-0 text-orange-500 dark:text-orange-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    );
  }

  // No match: no suggestion.
  return null;
};

export default CurrentSiteSuggestion;
