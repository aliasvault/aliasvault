import { isSharedFolder } from '@aliasvault/client/items/FolderUtils';
import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import FolderIcon from '@/entrypoints/popup/components/Folders/FolderIcon';
import FolderPickerModal from '@/entrypoints/popup/components/Items/FolderPickerModal';
import { useDb } from '@/entrypoints/popup/context/DbContext';

import type { Folder, FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';

type ItemNameInputProps = {
  inputRef?: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  folders: Folder[];
  selectedFolder: FolderRef | null | undefined;
  onFolderChange: (folder: FolderRef | null) => void;
  // Optional control rendered directly left of the input (the item logo).
  logoSlot?: React.ReactNode;
  suggestions?: string[];
};

/**
 * Item name input field with an integrated folder selection button and modal.
 * The folder button appears inside the input when folders are available.
 */
const ItemNameInput: React.FC<ItemNameInputProps> = ({
  inputRef,
  value,
  onChange,
  folders,
  selectedFolder: selectedFolderRef,
  onFolderChange,
  logoSlot,
  suggestions = []
}) => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const [showFolderModal, setShowFolderModal] = useState(false);

  const selectedFolderId = selectedFolderRef?.Id ?? null;
  const selectedManifestId = selectedFolderRef?.ManifestId ?? null;
  const selectedFolder = folders.find(f => f.Id === selectedFolderId && f.ManifestId === selectedManifestId);
  const personalManifestId = dbContext?.sqliteClient?.getPersonalManifestId() ?? null;

  /**
   * Handle name input change.
   */
  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    onChange(e.target.value);
  }, [onChange]);

  return (
    <>
      <div>
        {/* mb-1.5 rather than mb-1: the suggestion pills fill the whole line box, so they sit closer to the input than bare label text would */}
        <div className="flex items-center gap-2 mb-1.5">
          <label htmlFor="itemName" className="shrink-0 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('items.itemName')} <span className="text-red-500">*</span>
          </label>
          {/* Name suggestions, inline with the label so they don't add an extra row */}
          {suggestions.length > 0 && (
            <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto no-scrollbar" aria-label={t('items.suggestions')}>
              {suggestions.map(name => (
                <button
                  key={name}
                  type="button"
                  onClick={() => onChange(name)}
                  title={`${t('items.suggestions')}: ${name}`}
                  className="shrink-0 max-w-[7rem] truncate px-2 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-primary-100 dark:hover:bg-primary-900/40 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-stretch gap-2">
          {logoSlot}
          <div className="relative flex items-center flex-1 min-w-0">
            <input
              ref={inputRef}
              id="itemName"
              type="text"
              value={value}
              onChange={handleNameChange}
              className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:text-white ${selectedFolderId ? 'pr-28' : 'pr-10'}`}
              required
            />
            {/* Folder Button inside input - always visible, width adjusts based on whether a folder is selected */}
            <button
              type="button"
              onClick={() => setShowFolderModal(true)}
              className={`absolute right-1 z-10 flex items-center gap-1 px-2 py-1 rounded transition-colors text-xs ${
                selectedFolderId
                  ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 hover:bg-primary-200 dark:hover:bg-primary-900/50'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
              }`}
              title={selectedFolder?.Name || '-'}
            >
              <FolderIcon
                variant="outline"
                isShared={selectedFolder !== undefined && isSharedFolder(selectedFolder, personalManifestId)}
                className="w-4 h-4"
                badgeClassName="bg-white dark:bg-gray-700 ring-gray-200 dark:ring-gray-600"
              />
              {selectedFolderId && (
                <span className="max-w-16 truncate">
                  {selectedFolder?.Name}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {showFolderModal && (
        <FolderPickerModal selected={selectedFolderRef ?? null} onSelect={onFolderChange} onClose={() => setShowFolderModal(false)} />
      )}
    </>
  );
};

export default ItemNameInput;
