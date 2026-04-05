import React, { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';

import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useNavigationHistory } from '@/entrypoints/popup/hooks/useNavigationHistory';

import { getFolderPath, getFolderIdPath } from '@/utils/folderUtils';

type Breadcrumb = {
  name: string;
  id: string;
};

type FolderBreadcrumbProps = {
  /**
   * The ID of the current folder to show breadcrumbs for.
   * If null/undefined, no breadcrumbs are shown.
   */
  folderId: string | null | undefined;
  /**
   * Optional root path to navigate to when clicking the root breadcrumb.
   * Defaults to '/items'.
   */
  rootPath?: string;
  /**
   * Optional root label for the first breadcrumb.
   * Defaults to 'items.title' translation key.
   */
  rootLabel?: string;
};

/**
 * Displays a breadcrumb navigation trail for folder hierarchy.
 * Shows the path to the current location, excluding the current page itself.
 * Example: If viewing "Client A" folder, shows "Items > Work > Projects" (not including "Client A")
 */
const FolderBreadcrumb: React.FC<FolderBreadcrumbProps> = ({
  folderId,
  rootPath = '/items',
  rootLabel,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const dbContext = useDb();
  const { findStepsBack } = useNavigationHistory();

  /**
   * Compute breadcrumb trail based on current folder.
   * Excludes the current folder if we're viewing it (to avoid duplication with page title).
   */
  const breadcrumbs = useMemo((): Breadcrumb[] => {
    if (!folderId || !dbContext?.sqliteClient) {
      return [];
    }
    const allFolders = dbContext.sqliteClient.folders.getAll();
    const folderNames = getFolderPath(folderId, allFolders);
    const folderIds = getFolderIdPath(folderId, allFolders);
    const fullPath = folderNames.map((name, index) => ({
      name,
      id: folderIds[index]
    }));

    /*
     * If we're on the folder view page for this folder, exclude it from breadcrumbs
     * (it's already shown as the page title)
     */
    const currentFolderPath = `/items/folder/${folderId}`;
    if (location.pathname === currentFolderPath && fullPath.length > 0) {
      return fullPath.slice(0, -1); // Remove last item (current folder)
    }

    return fullPath;
  }, [folderId, dbContext?.sqliteClient, location.pathname]);

  /**
   * Handle breadcrumb navigation with history management.
   */
  const handleBreadcrumbClick = useCallback((targetPath: string) => {
    // Check if the target path exists in our navigation history
    const stepsBack = findStepsBack(targetPath);

    if (stepsBack !== null && stepsBack > 0) {
      // Path is in history - go back to it, removing all entries after it
      navigate(-stepsBack);
    } else {
      // Path not in history - navigate forward, adding it to the stack
      navigate(targetPath);
    }
  }, [navigate, findStepsBack]);

  /*
   * Check if we're currently on the root items page.
   * Match both /items and /items/ (with or without trailing slash)
   */
  const isOnRootPage = location.pathname === '/items' || location.pathname === '/items/';

  /*
   * Don't render anything if:
   * 1. No folderId provided (item/view is at root level) - saves UI space
   * 2. No breadcrumbs AND we're on the root page (would just show redundant "Items")
   */
  if (!folderId || (breadcrumbs.length === 0 && isOnRootPage)) {
    return null;
  }

  const rootLabelText = rootLabel ?? t('items.title');

  return (
    <div className="mb-3 flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 overflow-x-auto">
      {isOnRootPage ? (
        <span className="text-gray-900 dark:text-white font-medium flex-shrink-0 flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          {rootLabelText}
        </span>
      ) : (
        <button
          onClick={() => handleBreadcrumbClick(rootPath)}
          className="hover:text-orange-600 dark:hover:text-orange-400 transition-colors flex-shrink-0 flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          {rootLabelText}
        </button>
      )}
      {breadcrumbs.map((crumb) => {
        const crumbPath = `/items/folder/${crumb.id}`;

        return (
          <React.Fragment key={crumb.id}>
            <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 6 15 12 9 18" />
            </svg>
            <button
              onClick={() => handleBreadcrumbClick(crumbPath)}
              className="hover:text-orange-600 dark:hover:text-orange-400 transition-colors truncate"
              title={crumb.name}
            >
              {crumb.name}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default FolderBreadcrumb;
