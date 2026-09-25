import { scopedKey } from '@aliasvault/client/database/ItemRef';
import { buildFolderTree, getFolderIdPath, type FolderTreeNode } from '@aliasvault/client/items/FolderUtils';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  const tk = 'components.main.items.folderSelector';

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
  const excludedKey = excludeFolder ? folderKey(excludeFolder) : null;
  useEffect(() => {
    if (!selectedFolder || folders.length === 0) {
      return;
    }
    const parentKeys = getFolderIdPath(selectedFolder, folders).filter(id => id !== selectedFolder.Id).map(id => scopedKey(selectedFolder.ManifestId, id));
    setExpandedFolderIds(prev => new Set([...prev, ...parentKeys]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders, selectedKey]);

  const tree = useMemo(() => buildFolderTree(folders), [folders]);

  const flatTree = useMemo((): FolderTreeNode[] => {
    const result: FolderTreeNode[] = [];
    /**
     * Walk the tree, skipping the excluded folder and collapsed children.
     */
    const traverse = (nodes: FolderTreeNode[]): void => {
      for (const node of nodes) {
        if (folderKey(node) === excludedKey) {
          continue;
        }
        result.push(node);
        if (expandedFolderIds.has(folderKey(node)) && node.children.length > 0) {
          traverse(node.children);
        }
      }
    };
    traverse(tree);
    return result;
  }, [excludedKey, expandedFolderIds, tree]);

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
   * Classes of a folder row button.
   */
  const buttonClass = (key: string | null, isDisabled: boolean, hasChevron: boolean): string => {
    const base = `flex-1 px-3 py-2 text-left ${hasChevron ? 'rounded-r-md' : 'rounded-md'} flex items-center transition-colors`;
    if (isDisabled) {
      return `${base} bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed opacity-50`;
    }
    if (selectedKey === key) {
      return `${base} bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300`;
    }
    return `${base} text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700`;
  };

  /**
   * Classes of a folder row icon.
   */
  const iconClass = (key: string | null, isDisabled: boolean = false): string => {
    if (isDisabled) {
      return 'w-5 h-5 text-gray-300 dark:text-gray-700';
    }
    return selectedKey === key ? 'w-5 h-5 text-primary-500' : 'w-5 h-5 text-gray-400';
  };

  const selectedFolderRow = selectedKey ? folders.find(f => folderKey(f) === selectedKey) : undefined;
  const checkIcon = (
    <svg className="w-5 h-5 ml-auto text-primary-600 dark:text-primary-400" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );

  return (
    <>
      <div className="flex items-center gap-2 mt-2">
        <svg className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <button type="button" onClick={() => setShowFolderModal(true)} className="text-sm text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
          {selectedFolder ? <span className="text-primary-600 dark:text-primary-400">{selectedFolderRow?.Name}</span> : <span>{t(`${tk}.NoFolder`)}</span>}
        </button>
      </div>

      <FormModal
        isOpen={showFolderModal}
        title={t(`${tk}.SelectFolderTitle`)}
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
          <button type="button" onClick={() => selectFolder(null)} className={`${buttonClass(null, false, false)} w-full`}>
            <svg className={iconClass(null)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
            <span className="font-medium">&mdash;</span>
            {!selectedFolder && checkIcon}
          </button>

          {flatTree.map((node) => {
            const key = folderKey(node);
            const isDisabled = key === excludedKey;
            const hasChildren = node.children.length > 0;
            const isExpanded = expandedFolderIds.has(key);
            const count = itemCounts[key] ?? 0;
            return (
              <div key={key} className="flex items-stretch">
                {hasChildren ? (
                  <button type="button" onClick={(e) => {
                    e.stopPropagation();
                    toggleExpansion(key);
                  }} className="px-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-l-md transition-colors flex items-center" style={{ marginLeft: `${node.depth * 1.5}rem` }}>
                    <svg className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ) : (
                  <div className="w-8" style={{ marginLeft: `${node.depth * 1.5}rem` }}></div>
                )}

                <button type="button" onClick={() => selectFolder(node)} disabled={isDisabled} className={buttonClass(key, isDisabled, hasChildren)}>
                  <div className="flex items-center gap-3 flex-1">
                    <svg className={iconClass(key, isDisabled)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <span className="font-medium">{node.Name}</span>
                    {count > 0 && <span className="text-xs text-gray-400 dark:text-gray-500">({count})</span>}
                  </div>
                  {selectedKey === key && checkIcon}
                </button>
              </div>
            );
          })}

          {flatTree.length === 0 && <p className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 italic">{t(`${tk}.NoFoldersAvailable`)}</p>}
        </div>
      </FormModal>
    </>
  );
};

export default FolderSelector;
