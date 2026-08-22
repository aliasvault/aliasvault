import React from 'react';

import FolderIcon from '@/entrypoints/popup/components/Folders/FolderIcon';

type FolderWithCount = {
  id: string;
  name: string;
  itemCount: number;
};

interface IFolderPillProps {
  folder: FolderWithCount;
  onClick: () => void;
  isActive?: boolean;
  optionId?: string;
  isShared?: boolean;
}

/**
 * FolderPill component
 *
 * Displays a folder as a compact pill/tag that can be clicked to navigate into.
 * Designed to be displayed inline with other folder pills. Shared folders get a
 * small people badge overlaid on the folder icon.
 */
const FolderPill: React.FC<IFolderPillProps> = ({ folder, onClick, isActive = false, optionId, isShared = false }) => {
  return (
    <button
      id={optionId}
      role="option"
      aria-selected={isActive}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-600/50 rounded-full text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500/50 border ${
        isActive
          ? 'border-orange-500 dark:border-orange-400 ring-2 ring-orange-500/40'
          : 'border-gray-200 dark:border-gray-600'
      }`}
    >
      <FolderIcon isShared={isShared} className="w-3.5 h-3.5 text-orange-500 dark:text-orange-400" />
      <span className="text-gray-700 dark:text-gray-200 font-medium truncate max-w-[120px]">
        {folder.name}
      </span>
      {folder.itemCount > 0 && (
        <span className="text-gray-400 dark:text-gray-500 text-xs">
          {folder.itemCount}
        </span>
      )}
    </button>
  );
};

export default FolderPill;
