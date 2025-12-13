import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import type { Item } from '@/utils/dist/core/models/vault';
import { FieldKey } from '@/utils/dist/core/models/vault';

import ItemIcon from './ItemIcon';

type ItemCardProps = {
  item: Item;
  showFolderPath?: boolean;
};

/**
 * ItemCard component
 *
 * This component displays an item card with a name, logo, and fields.
 * It allows the user to navigate to the item details page when clicked.
 *
 */
const ItemCard: React.FC<ItemCardProps> = ({ item, showFolderPath = false }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

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

  return (
    <li>
      <button
        onClick={() => navigate(`/items/${item.Id}`)}
        className="w-full p-2 border dark:border-gray-600 rounded flex items-center bg-white dark:bg-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <div className="w-8 h-8 mr-2 flex-shrink-0">
          <ItemIcon item={item} className="w-8 h-8" />
        </div>
        <div className="text-left flex-1">
          <div className="flex items-center gap-1.5">
            <p className="font-medium text-gray-900 dark:text-white">
              {showFolderPath && item.FolderPath ? (
                <>
                  <span className="text-gray-500 dark:text-gray-400 text-sm">{item.FolderPath} &gt; </span>
                  {getItemName(item)}
                </>
              ) : (
                getItemName(item)
              )}
            </p>
            {item.HasPasskey && (
              <svg
                className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-label="Has passkey"
              >
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
            )}
            {item.HasAttachment && (
              <svg
                className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-label="Has attachments"
              >
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            )}
            {item.HasTotp && (
              <svg
                className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-label="Has 2FA"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            )}
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">{getDisplayText(item)}</p>
        </div>
      </button>
    </li>
  );
};

export default ItemCard;
