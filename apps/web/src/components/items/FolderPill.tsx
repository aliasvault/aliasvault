import React from 'react';

/**
 * A folder with the number of items it (recursively) holds.
 */
export type FolderWithCount = {
  id: string;
  manifestId: string;
  name: string;
  parentFolderId: string | null;
  itemCount: number;
};

/**
 * Clickable folder pill.
 */
const FolderPill: React.FC<{ folder: FolderWithCount; onClick: () => void }> = ({ folder, onClick }) => (
  <button onClick={onClick} className="inline-flex items-center gap-2 px-5 py-2.5 text-sm rounded-lg bg-white dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600/50 hover:border-gray-300 dark:hover:border-gray-500 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-1 dark:focus:ring-offset-gray-800">
    <svg className="w-4 h-4 text-orange-500 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
    </svg>
    <span className="text-gray-700 dark:text-gray-300 truncate max-w-[150px]" title={folder.name}>{folder.name}</span>
    <span className="text-gray-400 dark:text-gray-500 text-xs">{folder.itemCount}</span>
  </button>
);

export default FolderPill;
