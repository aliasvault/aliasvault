import React from 'react';

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
      <span className="relative flex-shrink-0">
        <svg
          className="w-3.5 h-3.5 text-orange-500 dark:text-orange-400"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
        </svg>
        {isShared && (
          <span className="absolute -bottom-1 -right-1 flex items-center justify-center w-2.5 h-2.5 rounded-full bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-600">
            <svg className="w-2 h-2 text-primary-500 dark:text-primary-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4.5 6.375a4.125 4.125 0 118.25 0 4.125 4.125 0 01-8.25 0zM14.25 8.625a3.375 3.375 0 116.75 0 3.375 3.375 0 01-6.75 0zM1.5 19.125a7.125 7.125 0 0114.25 0v.003l-.001.119a.75.75 0 01-.363.63 13.067 13.067 0 01-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 01-.364-.63l-.001-.122zM17.25 19.128l-.001.144a2.25 2.25 0 01-.233.96 10.088 10.088 0 005.06-1.01.75.75 0 00.42-.643 4.875 4.875 0 00-6.957-4.611 8.586 8.586 0 011.71 5.157v.003z" />
            </svg>
          </span>
        )}
      </span>
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
