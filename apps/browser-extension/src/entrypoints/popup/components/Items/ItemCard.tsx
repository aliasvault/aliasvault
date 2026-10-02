import { scopedKey, type ItemRef } from '@aliasvault/client/database/ItemRef';
import { truncateFolderPath } from '@aliasvault/client/items/FolderUtils';
import { FieldKey } from '@aliasvault/models/vault';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import Icon from '@/entrypoints/popup/components/Icons/Icon';

import { itemRoute } from '@/utils/ItemRoute';

import ItemContextMenu from './ItemContextMenu';
import ItemIcon from './ItemIcon';

import type { Item } from '@aliasvault/models/vault';

type ItemCardProps = {
  item: Item;
  showFolderPath?: boolean;
  searchTerm?: string;
  currentFolderPath?: string[] | null;
  isActive?: boolean;
  optionId?: string;
  isHighlighted?: boolean;
  onDuplicate?: (item: ItemRef) => void;
  onDelete?: (item: ItemRef) => void;
};

/**
 * ItemCard component
 *
 * This component displays an item card with a name, logo, and fields.
 * It allows the user to navigate to the item details page when clicked.
 *
 */
const ItemCard: React.FC<ItemCardProps> = ({ item, showFolderPath = false, searchTerm = '', currentFolderPath = null, isActive = false, optionId, isHighlighted = false, onDuplicate, onDelete }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const menuEnabled = Boolean(onDuplicate || onDelete);

  /**
   * Get the display text for the item (username or email)
   * @param itm - The item to get the display text for
   * @returns The display text for the item
   */
  const getDisplayText = (itm: Item): string => {
    let returnValue = '';

    // Try to find username field
    const usernameField = itm.Fields?.find(f => f.FieldKey === FieldKey.LoginUsername);
    if (usernameField && usernameField.Value) {
      returnValue = Array.isArray(usernameField.Value) ? usernameField.Value[0] : usernameField.Value;
    }

    // Try to find email field if no username
    if (!returnValue) {
      const emailField = itm.Fields?.find(f => f.FieldKey === FieldKey.LoginEmail);
      if (emailField && emailField.Value) {
        returnValue = Array.isArray(emailField.Value) ? emailField.Value[0] : emailField.Value;
      }
    }

    // Trim the return value to max. 33 characters.
    return returnValue.length > 33 ? returnValue.slice(0, 30) + '...' : returnValue;
  };

  /**
   * Get the item name, trimming it to maximum length so it doesn't overflow the UI.
   */
  const getItemName = (itm: Item): string => {
    let returnValue = t('items.untitled');

    if (itm.Name) {
      returnValue = itm.Name;
    }

    // Trim the return value to max. 33 characters.
    return returnValue.length > 33 ? returnValue.slice(0, 30) + '...' : returnValue;
  };

  /**
   * Get formatted folder path for display, relative to current folder if applicable.
   * When searching inside a folder, shows path relative to that folder instead of full path from root.
   * @param folderPath - Full folder path from root as array (e.g., ["Work", "Projects", "Sub"])
   * @param currentFolderPath - Current folder's full path as array (e.g., ["Work", "Projects"])
   * @returns Relative path string with truncation if needed
   */
  const getFormattedFolderPath = (folderPath: string[], currentFolderPath?: string[]): string => {
    if (!folderPath || folderPath.length === 0) {
      return '';
    }

    let segmentsToDisplay = folderPath;

    // If we're inside a folder while searching, show relative path
    if (currentFolderPath && currentFolderPath.length > 0) {
      // Check if item is in a subfolder of current folder
      const isInSubfolder = currentFolderPath.every((segment, index) => folderPath[index] === segment);

      if (isInSubfolder) {
        if (folderPath.length === currentFolderPath.length) {
          // Item is directly in current folder - don't show any path
          return '';
        }
        // Item is in a subfolder - show relative path (remove current folder prefix)
        segmentsToDisplay = folderPath.slice(currentFolderPath.length);
      }
      // else: Item is in a different branch - show full path
    }

    const truncated = truncateFolderPath(segmentsToDisplay, 3);
    return truncated.join(' > ');
  };

  /**
   * Open the item context menu from a right-click at the cursor position.
   */
  const handleContextMenu = (e: React.MouseEvent): void => {
    if (!menuEnabled) {
      return;
    }
    e.preventDefault();
    setMenuPosition({ x: e.clientX, y: e.clientY });
  };

  /**
   * Open the item context menu anchored below the ellipsis button.
   */
  const handleEllipsisClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuPosition({ x: rect.right - 160, y: rect.bottom + 4 });
  };

  return (
    <li id={optionId} data-item-key={scopedKey(item.ManifestId, item.Id)} role="option" aria-selected={isActive} className="relative group" onContextMenu={handleContextMenu}>
      <button
        onClick={() => {
          // Build URL with search query parameter if present
          const url = searchTerm ? `${itemRoute(item)}?returnSearch=${encodeURIComponent(searchTerm)}` : itemRoute(item);
          navigate(url);
        }}
        className={`w-full p-2 border rounded flex items-center bg-white dark:bg-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 ${
          menuEnabled ? 'pr-7' : ''
        } ${
          isActive || isHighlighted
            ? 'border-primary-500 dark:border-primary-400 ring-2 ring-primary-500/40'
            : 'border-gray-200 dark:border-gray-600'
        }`}
      >
        <div className="w-8 h-8 mr-2 flex-shrink-0">
          <ItemIcon item={item} className="w-8 h-8" />
        </div>
        <div className="text-left flex-1">
          <div className="flex items-center gap-1.5">
            <p className="font-medium text-gray-900 dark:text-white">
              {showFolderPath && item.FolderPath && item.FolderPath.length > 0 ? (
                <>
                  {(() : React.ReactNode => {
                    const relativePath = getFormattedFolderPath(item.FolderPath, currentFolderPath || undefined);
                    return relativePath ? (
                      <span className="text-gray-500 dark:text-gray-400 text-sm" title={item.FolderPath.join(' > ')}>
                        {relativePath} &gt;{' '}
                      </span>
                    ) : null;
                  })()}
                  {getItemName(item)}
                </>
              ) : (
                getItemName(item)
              )}
            </p>
            {item.HasPasskey && (
              <Icon name="key" className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" aria-label={t('items.hasPasskey')} />
            )}
            {item.HasAttachment && (
              <Icon name="paper-clip" className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" aria-label={t('items.hasAttachments')} />
            )}
            {item.HasTotp && (
              <Icon name="pin-material" className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" aria-label={t('items.hasTotp')} />
            )}
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">{getDisplayText(item)}</p>
        </div>
      </button>
      {menuEnabled && (
        <button
          onClick={handleEllipsisClick}
          aria-label={t('items.contextMenu.title')}
          aria-haspopup="menu"
          className={`absolute right-2 top-1/2 -translate-y-1/2 px-1 py-1 rounded text-gray-400 transition-opacity ${
            isActive || menuPosition ? 'opacity-100' : 'opacity-0'
          } group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500`}
        >
          <Icon name="dots-vertical-narrow" className="w-2 h-4" />
        </button>
      )}
      {menuPosition && (
        <ItemContextMenu
          position={menuPosition}
          onClose={() => setMenuPosition(null)}
          onEdit={() => navigate(itemRoute(item, true))}
          onDuplicate={() => onDuplicate?.({ Id: item.Id, ManifestId: item.ManifestId })}
          onDelete={() => onDelete?.({ Id: item.Id, ManifestId: item.ManifestId })}
        />
      )}
    </li>
  );
};

export default ItemCard;
