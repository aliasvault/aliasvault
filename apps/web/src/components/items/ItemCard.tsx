import { ItemTypes } from '@aliasvault/models/vault';
import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import ItemContextMenu, { type ItemContextMenuHandle } from '@/components/items/ItemContextMenu';
import ItemIcon from '@/components/items/ItemIcon';
import type { ItemListEntry } from '@/components/items/ItemListEntry';
import Icon from '@/components/shared/Icon';
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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const menuRef = useRef<ItemContextMenuHandle>(null);
  const serviceName = entry.service && entry.service.length > 0 ? entry.service : t('items.untitled');

  return (
    <div
      onClick={() => navigate(itemRoute({ Id: entry.id, ManifestId: entry.manifestId }))}
      onContextMenu={(e) => {
        e.preventDefault(); menuRef.current?.open(e.clientX, e.clientY); 
      }}
      className="credential-card relative group px-3 py-2.5 md:p-4 md:space-y-2 bg-white border border-gray-200 rounded-lg shadow-sm dark:border-gray-700 dark:bg-gray-800 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-200">
      <div className="absolute inset-y-0 right-2 flex items-center md:inset-y-auto md:top-2 md:block">
        <ItemContextMenu ref={menuRef} item={{ Id: entry.id, ManifestId: entry.manifestId }} itemName={entry.service} onMutated={onMutated} />
      </div>
      <div className="flex flex-row items-center gap-3 pr-8 text-left md:flex-col md:gap-0 md:px-4 md:py-2 md:text-center text-gray-400 rounded">
        <div className="flex-shrink-0 md:mb-2">
          <ItemIcon item={entry.item} altText={serviceName} sizeClass="w-9 h-9 md:w-12 md:h-12" />
        </div>
        <div className="min-w-0 flex-1 md:w-full">
          <div className="flex items-center justify-start md:justify-center gap-1.5 w-full">
            <div className="text-gray-900 dark:text-gray-100 break-words truncate md:max-w-[150px]" title={serviceName}>{serviceName}</div>
            {entry.hasTotp && (
              <Icon name="pin-material" className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400 flex-shrink-0" aria-label={t('items.hasTotp')} />
            )}
            {entry.hasPasskey && (
              <Icon name="key" className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400 flex-shrink-0" aria-label={t('items.hasPasskey')} />
            )}
            {entry.hasAttachment && (
              <Icon name="paper-clip" className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400 flex-shrink-0" aria-label={t('items.hasAttachments')} />
            )}
          </div>
          <div className="text-gray-500 dark:text-gray-400 break-words w-full text-sm truncate" title={getDisplayText(entry)}>{getDisplayText(entry)}</div>
        </div>
      </div>
    </div>
  );
};

export default ItemCard;
