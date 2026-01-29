import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

type Folder = {
  Id: string;
  Name: string;
};

type ItemNameInputProps = {
  inputRef?: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  folders: Folder[];
  selectedFolderId: string | null | undefined;
  onFolderChange: (folderId: string | null) => void;
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
  selectedFolderId,
  onFolderChange
}) => {
  const { t } = useTranslation();
  const [showFolderModal, setShowFolderModal] = useState(false);

  const selectedFolder = folders.find(f => f.Id === selectedFolderId);

  /**
   * Handle folder selection and close the modal.
   */
  const handleSelectFolder = useCallback((folderId: string | null): void => {
    onFolderChange(folderId);
    setShowFolderModal(false);
  }, [onFolderChange]);

  /**
   * Handle name input change.
   */
  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    onChange(e.target.value);
  }, [onChange]);

  /**
   * Handle opening folder modal.
   */
  const handleOpenFolderModal = useCallback((): void => {
    setShowFolderModal(true);
  }, []);

  /**
   * Handle closing folder modal.
   */
  const handleCloseFolderModal = useCallback((): void => {
    setShowFolderModal(false);
  }, []);

  return (
    <>
      <div>
        <label htmlFor="itemName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('items.itemName')} <span className="text-red-500">*</span>
        </label>
        <div className="relative flex items-center">
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
            onClick={handleOpenFolderModal}
            className={`absolute right-1 z-10 flex items-center gap-1 px-2 py-1 rounded transition-colors text-xs ${
              selectedFolderId
                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 hover:bg-primary-200 dark:hover:bg-primary-900/50'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
            }`}
            title={selectedFolder?.Name || '-'}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            {selectedFolderId && (
              <span className="max-w-16 truncate">
                {selectedFolder?.Name}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Folder Selection Modal */}
      {showFolderModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black bg-opacity-80 transition-opacity"
            onClick={handleCloseFolderModal}
          />

          {/* Modal */}
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <div className="relative transform overflow-hidden rounded-lg bg-white dark:bg-gray-800 px-4 pb-4 pt-5 text-left shadow-xl transition-all w-full max-w-sm">
              {/* Close button */}
              <button
                type="button"
                className="absolute right-4 top-4 text-gray-400 hover:text-gray-500 focus:outline-none"
                onClick={handleCloseFolderModal}
              >
                <span className="sr-only">{t('common.close')}</span>
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {/* Content */}
              <div className="mb-4">
                <h3 className="text-lg font-semibold leading-6 text-gray-900 dark:text-white">
                  {t('items.folder')}
                </h3>
              </div>

              {/* Folder Options */}
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {/* No Folder Option */}
                <button
                  type="button"
                  onClick={() => handleSelectFolder(null)}
                  className={`w-full px-3 py-2 text-left rounded-md flex items-center gap-3 transition-colors ${
                    !selectedFolderId
                      ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  <svg className={`w-5 h-5 ${!selectedFolderId ? 'text-primary-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                  </svg>
                  <span className="font-medium">&mdash;</span>
                  {!selectedFolderId && (
                    <svg className="w-5 h-5 ml-auto text-primary-600 dark:text-primary-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>

                {/* Folder Options */}
                {folders.map(folder => (
                  <button
                    key={folder.Id}
                    type="button"
                    onClick={() => handleSelectFolder(folder.Id)}
                    className={`w-full px-3 py-2 text-left rounded-md flex items-center gap-3 transition-colors ${
                      selectedFolderId === folder.Id
                        ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    <svg className={`w-5 h-5 ${selectedFolderId === folder.Id ? 'text-primary-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <span className="font-medium">{folder.Name}</span>
                    {selectedFolderId === folder.Id && (
                      <svg className="w-5 h-5 ml-auto text-primary-600 dark:text-primary-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ItemNameInput;
