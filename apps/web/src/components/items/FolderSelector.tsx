import { scopedKey } from '@aliasvault/client/database/ItemRef';
import { isSharedFolder } from '@aliasvault/client/items/FolderUtils';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FolderIcon from '@/components/folders/FolderIcon';
import FolderPickerModal from '@/components/items/FolderPickerModal';
import Icon from '@/components/shared/Icon';
import { useDb } from '@/context/DbContext';

import type { FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';

type FolderSelectorProps = {
  selectedFolder: FolderRef | null;
  onSelectedFolderChange: (folder: FolderRef | null) => void;
  excludeFolder?: FolderRef | null;
};

/**
 * Inline folder name with a modal to pick another folder from the tree.
 */
const FolderSelector: React.FC<FolderSelectorProps> = ({ selectedFolder, onSelectedFolderChange, excludeFolder = null }) => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const [showFolderModal, setShowFolderModal] = useState(false);
  const client = dbContext.sqliteClient;
  const personalManifestId = client?.getPersonalManifestId() ?? null;

  const selectedFolderRow = useMemo(() => {
    if (!selectedFolder) {
      return undefined;
    }
    const key = scopedKey(selectedFolder.ManifestId, selectedFolder.Id);
    return client?.folders.getAll().find(f => scopedKey(f.ManifestId, f.Id) === key);
  }, [client, selectedFolder]);

  return (
    <>
      <button
        type="button"
        id="folder-selector"
        onClick={() => setShowFolderModal(true)}
        className={`flex w-full items-center gap-2 mt-2.5 px-3 py-1 text-sm font-medium rounded-lg transition-colors ${selectedFolder
          ? 'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 border border-transparent hover:bg-gray-200 dark:hover:bg-gray-600'
          : 'text-gray-500 dark:text-gray-400 border border-dashed border-gray-300 dark:border-gray-600 hover:text-primary-600 dark:hover:text-primary-400 hover:border-primary-400 dark:hover:border-primary-500'}`}
      >
        {selectedFolder ? (
          <FolderIcon isShared={selectedFolderRow !== undefined && isSharedFolder(selectedFolderRow, personalManifestId)} className="w-4 h-4 text-primary-500" badgeClassName="bg-gray-100 dark:bg-gray-700 ring-gray-200 dark:ring-gray-600" />
        ) : (
          <Icon name="folder" className="w-4 h-4 flex-shrink-0" />
        )}
        <span className="truncate">{selectedFolder ? selectedFolderRow?.Name : t('items.folderSelector.noFolder')}</span>
        <Icon name="chevron-down" className="w-3.5 h-3.5 ml-auto flex-shrink-0 opacity-70" />
      </button>

      {showFolderModal && (
        <FolderPickerModal selected={selectedFolder} excludeFolder={excludeFolder} onSelect={onSelectedFolderChange} onClose={() => setShowFolderModal(false)} />
      )}
    </>
  );
};

export default FolderSelector;
