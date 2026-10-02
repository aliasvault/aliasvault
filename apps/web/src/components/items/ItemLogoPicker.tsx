import { effectiveItemLogo, logoSourceTranslationKey } from '@aliasvault/client/items/ItemLogoView';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ItemIcon from '@/components/items/ItemIcon';
import LogoPickerModal from '@/components/items/LogoPickerModal';
import Icon from '@/components/shared/Icon';

import type { Item, LogoSelection } from '@aliasvault/models/vault';

type ItemLogoPickerProps = {
  item: Item;
  pendingSelection?: LogoSelection;
  faviconSource?: string | null;
  websiteSource?: string | null;
  isFetching?: boolean;
  onSelect: (selection: LogoSelection) => void;
  onFetchFromWebsite: () => void;
};

/**
 * The item's icon on the edit page.
 */
const ItemLogoPicker: React.FC<ItemLogoPickerProps> = ({ item, pendingSelection, faviconSource, websiteSource, isFetching = false, onSelect, onFetchFromWebsite }) => {
  const { t } = useTranslation();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const closePicker = useCallback((): void => setIsPickerOpen(false), []);

  const effectiveLogo = effectiveItemLogo(item.LogoInfo, pendingSelection, faviconSource);
  const source = t(logoSourceTranslationKey(effectiveLogo), { domain: effectiveLogo?.Source });

  return (
    <>
      <button
        type="button"
        id="item-logo-picker"
        onClick={() => setIsPickerOpen(true)}
        title={`${t('items.logo.chooseLogo')}: ${source}`}
        aria-label={t('items.logo.chooseLogo')}
        className="flex items-center justify-center w-20 h-20 flex-shrink-0 cursor-pointer rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 hover:border-primary-500 dark:hover:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors"
      >
        {isFetching ? (
          <Icon name="spinner" className="animate-spin w-7 h-7 text-gray-500 dark:text-gray-300" />
        ) : (
          <ItemIcon item={{ ...item, LogoInfo: effectiveLogo }} sizeClass="w-12 h-12" />
        )}
      </button>

      {isPickerOpen && (
        <LogoPickerModal
          item={item}
          currentLogo={effectiveLogo}
          websiteSource={websiteSource}
          onSelect={onSelect}
          onFetchFromWebsite={onFetchFromWebsite}
          onClose={closePicker}
        />
      )}
    </>
  );
};

export default ItemLogoPicker;
