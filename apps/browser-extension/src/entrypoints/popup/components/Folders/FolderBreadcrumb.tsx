import { getFolderPath, getFolderIdPath } from '@aliasvault/client/items/FolderUtils';
import React, { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';

import Icon from '@/entrypoints/popup/components/Icons/Icon';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useNavigationHistory } from '@/entrypoints/popup/hooks/useNavigationHistory';

import type { FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';

type Breadcrumb = {
  name: string;
  id: string;
};

type FolderBreadcrumbProps = {
  /**
   * The current folder to show breadcrumbs for.
   * If null/undefined, no breadcrumbs are shown.
   */
  folder: FolderRef | null | undefined;
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
  folder,
  rootPath = '/items',
  rootLabel,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const dbContext = useDb();
  const { findStepsBack } = useNavigationHistory();
  const folderId = folder?.Id ?? null;
  const manifestId = folder?.ManifestId ?? null;

  /**
   * Compute breadcrumb trail based on current folder.
   * Excludes the current folder if we're viewing it (to avoid duplication with page title).
   */
  const breadcrumbs = useMemo((): Breadcrumb[] => {
    if (!folderId || !manifestId || !dbContext?.sqliteClient) {
      return [];
    }
    const ref = { Id: folderId, ManifestId: manifestId };
    const allFolders = dbContext.sqliteClient.folders.getAll();
    const folderNames = getFolderPath(ref, allFolders);
    const folderIds = getFolderIdPath(ref, allFolders);
    const fullPath = folderNames.map((name, index) => ({
      name,
      id: folderIds[index]
    }));

    /*
     * If we're on the folder view page for this folder, exclude it from breadcrumbs
     * (it's already shown as the page title)
     */
    const currentFolderPath = `/items/folder/${manifestId}/${folderId}`;
    if (location.pathname === currentFolderPath && fullPath.length > 0) {
      return fullPath.slice(0, -1); // Remove last item (current folder)
    }

    return fullPath;
  }, [folderId, manifestId, dbContext?.sqliteClient, location.pathname]);

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
          <Icon name="home" className="w-4 h-4" />
          {rootLabelText}
        </span>
      ) : (
        <button
          onClick={() => handleBreadcrumbClick(rootPath)}
          className="hover:text-orange-600 dark:hover:text-orange-400 transition-colors flex-shrink-0 flex items-center gap-1"
        >
          <Icon name="home" className="w-4 h-4" />
          {rootLabelText}
        </button>
      )}
      {breadcrumbs.map((crumb) => {
        const crumbPath = `/items/folder/${manifestId}/${crumb.id}`;

        return (
          <React.Fragment key={crumb.id}>
            <Icon name="chevron-right" className="w-4 h-4 flex-shrink-0" />
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
