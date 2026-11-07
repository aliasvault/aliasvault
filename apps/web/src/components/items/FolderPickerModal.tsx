import { scopedKey } from '@aliasvault/client/database/ItemRef';
import { buildFolderTree, flattenFolderTree, getFolderIdPath, isSharedFolder } from '@aliasvault/client/items/FolderUtils';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FolderIcon from '@/components/folders/FolderIcon';
import FormModal from '@/components/shared/FormModal';
import Icon from '@/components/shared/Icon';
import { useDb } from '@/context/DbContext';

import type { FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';

type FolderPickerModalProps = {
  selected: FolderRef | null;
  onSelect: (folder: FolderRef | null) => void;
  onClose: () => void;
  excludeFolder?: FolderRef | null;
};

/**
 * The key of a folder in the picker's maps including the manifest id as scope.
 */
const folderKey = (folder: FolderRef): string => scopedKey(folder.ManifestId, folder.Id);

/** Indent per folder level. */
const FOLDER_INDENT_REM = 1.25;

/**
 * Modal to pick a folder from the tree; shown while mounted.
 */
const FolderPickerModal: React.FC<FolderPickerModalProps> = ({ selected, onSelect, onClose, excludeFolder = null }) => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const client = dbContext.sqliteClient;
  const personalManifestId = client?.getPersonalManifestId() ?? null;

  const folders = useMemo(() => client?.folders.getAll() ?? [], [client]);

  const itemCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of client?.items.getAll() ?? []) {
      if (item.FolderId) {
        const key = scopedKey(item.ManifestId, item.FolderId);
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    return counts;
  }, [client]);

  // Start with the parents of the selected folder expanded so it is visible.
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => new Set(selected ? getFolderIdPath(selected, folders).filter(id => id !== selected.Id).map(id => scopedKey(selected.ManifestId, id)) : []));

  const tree = useMemo(() => buildFolderTree(folders), [folders]);

  const flatTree = useMemo(() => flattenFolderTree(tree, expandedFolderIds, excludeFolder), [tree, expandedFolderIds, excludeFolder]);

  const selectedKey = selected ? folderKey(selected) : null;

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
    onSelect(folder ? { Id: folder.Id, ManifestId: folder.ManifestId } : null);
    onClose();
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

  const checkIcon = (
    <Icon name="check" className="w-5 h-5 ml-auto flex-shrink-0 text-primary-600 dark:text-primary-400" />
  );

  return (
    <FormModal
      isOpen
      title={t('items.folders.selectFolder')}
      showDefaultFooter={false}
      maxWidth="sm"
      onClose={onClose}
      icon={(
        <Icon name="folder-filled" className="h-6 w-6 text-primary-600 dark:text-primary-400" />
      )}
    >
      <div className="space-y-1 max-h-64 overflow-y-auto -mx-2">
        <button type="button" onClick={() => selectFolder(null)} className={`w-full px-3 py-2 text-left rounded-md flex items-center gap-3 transition-colors ${rowClass(null)}`}>
          <Icon name="archive" className={iconClass(null)} />
          <span className="font-medium">{t('items.folderSelector.noFolder')}</span>
          {!selected && checkIcon}
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
  );
};

export default FolderPickerModal;
