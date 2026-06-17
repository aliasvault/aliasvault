import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';

import { buildFolderTree, type FolderTreeNode } from '@/utils/folderUtils';

type Folder = {
  Id: string;
  Name: string;
  ParentFolderId: string | null;
  Weight: number;
};

type MoveToFolderModalProps = {
  isOpen: boolean;
  onClose: () => void;
  /** Folders available to move items into. */
  folders: Folder[];
  /** Number of items that will be moved (used for the modal title). */
  itemCount: number;
  /** Called with `null` for root or the selected folder id. */
  onMove: (folderId: string | null) => void | Promise<void>;
};

/**
 * Bulk "move items to folder" modal.
 *
 * Renders a tree view of all folders and lets the user pick a destination
 * (root, or any folder). Selection of a destination immediately invokes
 * `onMove` and closes the modal — matching the single-item folder picker
 * UX from {@link file://./ItemNameInput.tsx ItemNameInput}.
 */
const MoveToFolderModal: React.FC<MoveToFolderModalProps> = ({
  isOpen,
  onClose,
  folders,
  itemCount,
  onMove,
}) => {
  const { t } = useTranslation();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);

  /**
   * Toggle folder expansion in tree view.
   */
  const toggleFolder = useCallback((folderId: string): void => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  /**
   * Handle selecting a destination folder (or root).
   */
  const handleSelect = useCallback(async (folderId: string | null): Promise<void> => {
    await onMove(folderId);
    onClose();
  }, [onMove, onClose]);

  /**
   * Render a folder tree node recursively.
   */
  const renderFolderNode = useCallback((node: FolderTreeNode, depth: number = 0): React.ReactNode => {
    const isExpanded = expandedFolders.has(node.Id);
    const hasChildren = node.children.length > 0;

    return (
      <div key={node.Id}>
        <button
          type="button"
          onClick={() => handleSelect(node.Id)}
          className="w-full px-3 py-2 text-left rounded-md flex items-center gap-2 transition-colors text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          style={{ paddingLeft: `${depth * 12 + 12}px` }}
        >
          {hasChildren && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleFolder(node.Id);
              }}
              className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
            >
              <svg
                className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
            </button>
          )}

          <svg
            className={`w-5 h-5 shrink-0 text-gray-400 ${!hasChildren ? 'ml-5' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>

          <span className="font-medium flex-1">{node.Name}</span>
        </button>

        {hasChildren && isExpanded && (
          <div>
            {node.children.map(child => renderFolderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }, [expandedFolders, handleSelect, toggleFolder]);

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      title={t('items.bulkMoveTitle', { count: itemCount })}
      maxWidth="max-w-sm"
    >
      <div className="space-y-1 max-h-72 overflow-y-auto">
        {/* "Move to root" option */}
        <button
          type="button"
          onClick={() => handleSelect(null)}
          className="w-full px-3 py-2 text-left rounded-md flex items-center gap-3 transition-colors text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
          </svg>
          <span className="font-medium">&mdash;</span>
        </button>

        {folderTree.map(node => renderFolderNode(node, 0))}
      </div>
    </ModalWrapper>
  );
};

export default MoveToFolderModal;
