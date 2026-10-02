import { scopedKey } from '@aliasvault/client/database/ItemRef';
import { buildFolderTree, flattenFolderTree, getFolderIdPath, isSharedFolder } from '@aliasvault/client/items/FolderUtils';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FolderIcon from '@/components/folders/FolderIcon';
import FormModal from '@/components/shared/FormModal';
import Icon from '@/components/shared/Icon';
import { useDb } from '@/context/DbContext';

import type { Folder, FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';

type FolderSelectorProps = {
  selectedFolder: FolderRef | null;
  onSelectedFolderChange: (folder: FolderRef | null) => void;
  excludeFolder?: FolderRef | null;
};

/**
 * The key of a folder in the selector's maps including the manifest id as scope.
 */
const folderKey = (folder: FolderRef): string => scopedKey(folder.ManifestId, folder.Id);

/** Indent per folder level. */
const FOLDER_INDENT_REM = 1.25;

/**
 * Inline folder name with a modal to pick another folder from the tree.
 */
const FolderSelector: React.FC<FolderSelectorProps> = ({ selectedFolder, onSelectedFolderChange, excludeFolder = null }) => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [showFolderModal, setShowFolderModal] = useState(false);
  
  const personalManifestId = dbContext.sqliteClient?.getPersonalManifestId() ?? null;

  useEffect(() => {
    const client = dbContext.sqliteClient;
    if (!client) {
      return;
    }
    const all = client.folders.getAll();
    setFolders(all);
    const counts: Record<string, number> = {};
    for (const item of client.items.getAll()) {
      if (item.FolderId) {
        const key = scopedKey(item.ManifestId, item.FolderId);
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    setItemCounts(counts);
  }, [dbContext.sqliteClient]);

  // Expand the parents of the selected folder so it is visible.
  const selectedKey = selectedFolder ? folderKey(selectedFolder) : null;
  useEffect(() => {
    if (!selectedFolder || folders.length === 0) {
      return;
    }
    const parentKeys = getFolderIdPath(selectedFolder, folders).filter(id => id !== selectedFolder.Id).map(id => scopedKey(selectedFolder.ManifestId, id));
    setExpandedFolderIds(prev => new Set([...prev, ...parentKeys]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders, selectedKey]);

  const tree = useMemo(() => buildFolderTree(folders), [folders]);

  const flatTree = useMemo(() => flattenFolderTree(tree, expandedFolderIds, excludeFolder), [tree, expandedFolderIds, excludeFolder]);

  /**
   * Expand or collapse a folder.
   */
  const toggleExpansion = (key: string): void => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  /**
   * Pick a folder and close.
   */
  const selectFolder = (folder: FolderRef | null): void => {
    onSelectedFolderChange(folder ? { Id: folder.Id, ManifestId: folder.ManifestId } : null);
    setShowFolderModal(false);
  };

  /**
   * Classes of a folder row.
   */
  const rowClass = (key: string | null): string => selectedKey === key
    ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700';

  /**
   * Classes of a folder row icon.
   */
  const iconClass = (key: string | null): string => selectedKey === key ? 'w-5 h-5 flex-shrink-0 text-primary-500' : 'w-5 h-5 flex-shrink-0 text-gray-400';

  const selectedFolderRow = selectedKey ? folders.find(f => folderKey(f) === selectedKey) : undefined;
  const checkIcon = (
    <Icon name="check" className="w-5 h-5 ml-auto flex-shrink-0 text-primary-600 dark:text-primary-400" />
  );

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
          <FolderIcon isShared={selectedFolderRow !== undefined && isSharedFolder(selectedFolderRow, personalManifestId)} className="w-4 h-4 text-orange-500" badgeClassName="bg-gray-100 dark:bg-gray-700 ring-gray-200 dark:ring-gray-600" />
        ) : (
          <Icon name="folder" className="w-4 h-4 flex-shrink-0" />
        )}
        <span className="truncate">{selectedFolder ? selectedFolderRow?.Name : t('items.folderSelector.noFolder')}</span>
        <Icon name="chevron-down" className="w-3.5 h-3.5 ml-auto flex-shrink-0 opacity-70" />
      </button>

      <FormModal
        isOpen={showFolderModal}
        title={t('items.folders.selectFolder')}
        showDefaultFooter={false}
        maxWidth="sm"
        onClose={() => setShowFolderModal(false)}
        icon={(
          <Icon name="folder-filled" className="h-6 w-6 text-orange-600 dark:text-orange-400" />
        )}
      >
        <div className="space-y-1 max-h-64 overflow-y-auto -mx-2">
          <button type="button" onClick={() => selectFolder(null)} className={`w-full px-3 py-2 text-left rounded-md flex items-center gap-3 transition-colors ${rowClass(null)}`}>
            <Icon name="archive" className={iconClass(null)} />
            <span className="font-medium">&mdash;</span>
            {!selectedFolder && checkIcon}
          </button>

          {flatTree.map((node) => {
            const key = folderKey(node);
            const hasChildren = node.children.length > 0;
            const isExpanded = expandedFolderIds.has(key);
            const count = itemCounts[key] ?? 0;
            return (
              <div key={key} className={`flex items-center rounded-md transition-colors ${rowClass(key)}`} style={{ paddingLeft: `${node.depth * FOLDER_INDENT_REM + 0.25}rem` }}>
                {hasChildren ? (
                  <button type="button" onClick={() => toggleExpansion(key)} aria-expanded={isExpanded} className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                    <Icon name="chevron-right" className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  </button>
                ) : (
                  <span className="flex-shrink-0 w-7" />
                )}

                <button type="button" onClick={() => selectFolder(node)} className="flex-1 min-w-0 pl-1 pr-3 py-2 text-left flex items-center gap-3">
                  <FolderIcon variant="outline" isShared={isSharedFolder(node, personalManifestId)} className={iconClass(key)} />
                  <span className="font-medium truncate">{node.Name}</span>
                  {count > 0 && <span className="flex-shrink-0 text-xs text-gray-400 dark:text-gray-500">({count})</span>}
                  {selectedKey === key && checkIcon}
                </button>
              </div>
            );
          })}

          {flatTree.length === 0 && <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 italic">{t('items.folderSelector.noFoldersAvailable')}</p>}
        </div>
      </FormModal>
    </>
  );
};

export default FolderSelector;
