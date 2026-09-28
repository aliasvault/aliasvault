import { ItemTypes } from '@aliasvault/models/vault';
import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import ItemContextMenu, { type ItemContextMenuHandle } from '@/components/items/ItemContextMenu';
import ItemIcon from '@/components/items/ItemIcon';
import type { ItemListEntry } from '@/components/items/ItemListEntry';
import { itemRoute } from '@/utils/ItemRoute';

type ItemCardProps = {
  entry: ItemListEntry;
  onMutated: () => void;
};

/**
 * The secondary line of a card.
 * @param entry - the entry
 */
const getDisplayText = (entry: ItemListEntry): string => {
  if (entry.itemType === ItemTypes.CreditCard) {
    return entry.cardNumber && entry.cardNumber.length >= 4 ? '•••• ' + entry.cardNumber.slice(-4) : '';
  }
  if (entry.itemType === ItemTypes.Note) {
    return '';
  }
  return entry.username ?? entry.email ?? '';
};

/**
 * Item card in the grid view.
 */
const ItemCard: React.FC<ItemCardProps> = ({ entry, onMutated }) => {
  const navigate = useNavigate();
  const menuRef = useRef<ItemContextMenuHandle>(null);
  const serviceName = entry.service && entry.service.length > 0 ? entry.service : 'Untitled';

  return (
    <div
      onClick={() => navigate(itemRoute({ Id: entry.id, ManifestId: entry.manifestId }))}
      onContextMenu={(e) => {
        e.preventDefault(); menuRef.current?.open(e.clientX, e.clientY); 
      }}
      className="credential-card relative group p-4 space-y-2 bg-white border border-gray-200 rounded-lg shadow-sm dark:border-gray-700 dark:bg-gray-800 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-200">
      <div className="absolute top-2 right-2">
        <ItemContextMenu ref={menuRef} item={{ Id: entry.id, ManifestId: entry.manifestId }} itemName={entry.service} onMutated={onMutated} />
      </div>
      <div className="px-4 py-2 text-gray-400 rounded text-center flex flex-col items-center">
        <div className="mb-2">
          <ItemIcon item={entry.item} altText={serviceName} sizeClass="w-12 h-12" />
        </div>
        <div className="flex items-center justify-center gap-1.5 w-full">
          <div className="text-gray-900 dark:text-gray-100 break-words truncate max-w-[150px]" title={serviceName}>{serviceName}</div>
          {entry.hasTotp && (
            <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400 flex-shrink-0" viewBox="0 -960 960 960" fill="currentColor" aria-label="Has TOTP">
              <path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm100-200h46v-240h-36l-70 50 24 36 36-26v180Zm124 0h156v-40h-94l-2-2q21-20 34.5-34t21.5-22q18-18 27-36t9-38q0-29-22-48.5T458-600q-26 0-47 15t-29 39l40 16q5-13 14.5-20.5T458-558q15 0 24.5 8t9.5 20q0 11-4 20.5T470-486l-32 32-54 54v40Zm296 0q36 0 58-20t22-52q0-18-10-32t-28-22v-2q14-8 22-20.5t8-29.5q0-27-21-44.5T678-600q-25 0-46.5 14.5T604-550l40 16q4-12 13-19t21-7q13 0 21.5 7.5T708-534q0 14-10 22t-26 8h-18v40h20q20 0 31 8t11 22q0 13-11 22.5t-25 9.5q-17 0-26-7.5T638-436l-40 16q7 29 28.5 44.5T680-360ZM160-240h640v-480H160v480Zm0 0v-480 480Z" />
            </svg>
          )}
          {entry.hasPasskey && (
            <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Has passkey">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
          )}
          {entry.hasAttachment && (
            <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Has attachments">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          )}
        </div>
        <div className="text-gray-500 dark:text-gray-400 break-words w-full text-sm truncate" title={getDisplayText(entry)}>{getDisplayText(entry)}</div>
      </div>
    </div>
  );
};

export default ItemCard;
