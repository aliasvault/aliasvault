import { scopedKey } from '@aliasvault/client/database/ItemRef';
import { getFolderPath, truncateFolderPath } from '@aliasvault/client/items/FolderUtils';
import { applySearchFilter } from '@aliasvault/client/items/ItemFilters';
import { FieldKey, type Item } from '@aliasvault/models/vault';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import ItemIcon from '@/components/items/ItemIcon';
import { getFieldValue } from '@/components/items/ItemListEntry';
import { useDb } from '@/context/DbContext';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';
import { itemRoute } from '@/utils/ItemRoute';

const SEARCH_DEBOUNCE_MS = 100;
const MAX_RESULTS = 10;

/**
 * A search result with its folder path.
 */
type SearchResult = {
  item: Item;
  folderPath: string[];
};

/**
 * The vault search box in the top bar.
 */
const SearchWidget: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const dbContext = useDb();
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showPopup, setShowPopup] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Close the popup.
   */
  const close = useCallback((): void => setShowPopup(false), []);
  useClickOutside([containerRef], close, showPopup);

  /**
   * Focus the search field (g+s / g+f).
   */
  const focusSearchField = useCallback((): void => inputRef.current?.focus(), []);
  useKeyboardShortcut('gs', focusSearchField);
  useKeyboardShortcut('gf', focusSearchField);

  /**
   * Reset the field on navigation.
   */
  useEffect(() => {
    setSearchTerm('');
    setResults([]);
    setSelectedIndex(-1);
    setShowPopup(false);
    setIsLoading(false);
  }, [location.pathname]);

  /**
   * Run the search after the debounce.
   */
  const performSearch = useCallback((term: string): void => {
    const sqliteClient = dbContext.sqliteClient;
    if (!sqliteClient || term.length < 2) {
      setResults([]);
      setSelectedIndex(-1);
      setIsLoading(false);
      return;
    }

    const allFolders = sqliteClient.folders.getAll();
    const matches = applySearchFilter(sqliteClient.items.getAll(), term).slice(0, MAX_RESULTS);
    setResults(matches.map(item => ({ item, folderPath: item.FolderId ? getFolderPath({ Id: item.FolderId, ManifestId: item.ManifestId }, allFolders) : [] })));
    setSelectedIndex(matches.length > 0 ? 0 : -1);
    setIsLoading(false);
  }, [dbContext.sqliteClient]);

  /**
   * Handle typing: debounce the search.
   */
  const onSearchTermChanged = (value: string): void => {
    setSearchTerm(value);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    if (value.length < 2) {
      setResults([]);
      setSelectedIndex(-1);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    timerRef.current = setTimeout(() => performSearch(value), SEARCH_DEBOUNCE_MS);
  };

  /**
   * Open an item.
   */
  const selectResult = (item: Item): void => {
    inputRef.current?.blur();
    navigate(itemRoute(item));
  };

  /**
   * Keyboard navigation through the results.
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    switch (e.key) {
      case 'ArrowDown':
        setSelectedIndex(Math.min(selectedIndex + 1, results.length - 1));
        break;
      case 'ArrowUp':
        setSelectedIndex(Math.max(selectedIndex - 1, -1));
        break;
      case 'Enter':
        if (selectedIndex >= 0 && selectedIndex < results.length) {
          selectResult(results[selectedIndex].item);
        }
        break;
    }
  };

  /**
   * "First > ... > Last" for long paths.
   */
  const formatFolderPath = (path: string[]): string => truncateFolderPath(path, 3).join(' > ');

  const popupClass = 'absolute z-10 w-screen left-0 sm:left-auto sm:w-full mt-1 bg-white rounded-md shadow-lg dark:bg-gray-800 text-sm text-gray-600 dark:text-gray-400';

  return (
    <div className="relative" id="searchWidgetContainer" ref={containerRef}>
      <input
        ref={inputRef}
        id="searchWidget"
        type="text"
        placeholder={t('components.main.widgets.searchWidget.SearchVaultPlaceholder')}
        autoComplete="off"
        className="w-full px-4 py-2 text-gray-700 bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:focus:ring-primary-500"
        value={searchTerm}
        onChange={(e) => onSearchTermChanged(e.target.value)}
        onFocus={() => setShowPopup(true)}
        onClick={() => setShowPopup(true)}
        onKeyDown={handleKeyDown} />

      {showPopup && (
        <>
          <div className="absolute z-10 w-full mt-1 bg-white rounded-md shadow-lg dark:bg-gray-800 p-2 text-sm text-gray-600 dark:text-gray-400">
            {searchTerm.length === 0 ? (
              <p>{t('components.main.widgets.searchWidget.SearchHelpText')}</p>
            ) : searchTerm.length === 1 ? (
              <p>{t('components.main.widgets.searchWidget.SearchTooShortMessage')}</p>
            ) : (
              <p>{t('components.main.widgets.searchWidget.SearchingForMessage', { 0: searchTerm })}</p>
            )}
          </div>

          {searchTerm.length >= 2 && (
            isLoading ? (
              <div className={popupClass}>
                <div className="px-4 py-2 flex items-center">
                  <svg className="animate-spin -ml-1 mr-3 h-4 w-4 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {t('components.main.widgets.searchWidget.SearchingMessage')}
                </div>
              </div>
            ) : results.length > 0 ? (
              <div className={popupClass}>
                {results.map((result, index) => {
                  const email = getFieldValue(result.item, FieldKey.LoginEmail);
                  const username = getFieldValue(result.item, FieldKey.LoginUsername);
                  return (
                    <div key={scopedKey(result.item.ManifestId, result.item.Id)} className={`search-result ${index === selectedIndex ? 'bg-gray-100 dark:bg-gray-700' : ''} px-4 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center`} onClick={() => selectResult(result.item)}>
                      <ItemIcon item={result.item} altText={result.item.Name ?? ''} sizeClass="w-6 h-6" />
                      <div className="ml-2">
                        <div className="font-medium text-gray-900 dark:text-white">
                          {result.folderPath.length > 0 && (
                            <span className="text-gray-500 dark:text-gray-400 text-sm font-normal" title={result.folderPath.join(' > ')}>
                              {formatFolderPath(result.folderPath)} &gt;{' '}
                            </span>
                          )}
                          {result.item.Name}
                        </div>
                        {email ? (
                          <span className="text-gray-500">({email})</span>
                        ) : username ? (
                          <span className="text-gray-500">({username})</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={popupClass}>
                <div className="px-4 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700">
                  {t('components.main.widgets.searchWidget.NoResultsFoundMessage')}
                </div>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
};

export default SearchWidget;
