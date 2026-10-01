import { scopedKey } from '@aliasvault/client/database/ItemRef';
import { buildFolderTree, flattenFolderTree, getFolderIdPath, isSharedFolder } from '@aliasvault/client/items/FolderUtils';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FolderIcon from '@/components/folders/FolderIcon';
import FormModal from '@/components/shared/FormModal';
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
    <svg className="w-5 h-5 ml-auto flex-shrink-0 text-primary-600 dark:text-primary-400" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
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
          <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        )}
        <span className="truncate">{selectedFolder ? selectedFolderRow?.Name : t('items.folderSelector.noFolder')}</span>
        <svg className="w-3.5 h-3.5 ml-auto flex-shrink-0 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <FormModal
        isOpen={showFolderModal}
        title={t('items.folders.selectFolder')}
        showDefaultFooter={false}
        maxWidth="sm"
        onClose={() => setShowFolderModal(false)}
        icon={(
          <svg className="h-6 w-6 text-orange-600 dark:text-orange-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
          </svg>
        )}
      >
        <div className="space-y-1 max-h-64 overflow-y-auto -mx-2">
          <button type="button" onClick={() => selectFolder(null)} className={`w-full px-3 py-2 text-left rounded-md flex items-center gap-3 transition-colors ${rowClass(null)}`}>
            <svg className={iconClass(null)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
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
                    <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                    </svg>
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
