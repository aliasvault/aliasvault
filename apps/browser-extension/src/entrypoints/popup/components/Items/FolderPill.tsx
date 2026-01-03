import React from 'react';

type FolderWithCount = {
  id: string;
  name: string;
  itemCount: number;
};

interface IFolderPillProps {
  folder: FolderWithCount;
  onClick: () => void;
}

/**
 * FolderPill component
 *
 * Displays a folder as a compact pill/tag that can be clicked to navigate into.
 * Designed to be displayed inline with other folder pills.
 */
const FolderPill: React.FC<IFolderPillProps> = ({ folder, onClick }) => {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-gray-700/50 hover:bg-gray-200 dark:hover:bg-gray-600/50 border border-gray-200 dark:border-gray-600 rounded-full text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500/50"
    >
      <svg
        className="w-3.5 h-3.5 text-orange-500 dark:text-orange-400 flex-shrink-0"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
      </svg>
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
