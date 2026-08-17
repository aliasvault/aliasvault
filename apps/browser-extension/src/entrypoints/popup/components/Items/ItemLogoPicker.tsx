import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import LogoPickerModal from '@/entrypoints/popup/components/Items/LogoPickerModal';

import type { DraftItem } from '@/utils/db/ItemRef';
import type { LogoSelection, ItemLogo } from '@/utils/dist/core/models/vault';
import { LogoKinds } from '@/utils/dist/core/models/vault';

import ItemIconComponent from './ItemIcon';

type ItemLogoPickerProps = {
  item: DraftItem;
  pendingSelection?: LogoSelection;
  faviconSource?: string | null;
  isFetching?: boolean;
  onSelect: (selection: LogoSelection) => void;
  onFetchFromWebsite: () => void;
};

/**
 * The item's icon on the edit screen: shows what the item will look like and opens the picker.
 */
const ItemLogoPicker: React.FC<ItemLogoPickerProps> = ({ item, pendingSelection, faviconSource, isFetching = false, onSelect, onFetchFromWebsite }) => {
  const { t } = useTranslation();
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  /*
   * What the item will show once saved: an unsaved choice takes precedence over the stored logo, so
   * the preview matches the outcome rather than the past.
   */
  let effectiveLogo: ItemLogo | undefined = item.LogoInfo;
  if (pendingSelection?.Kind === LogoKinds.Favicon) {
    effectiveLogo = faviconSource ? { Id: '', Kind: LogoKinds.Favicon, Source: faviconSource } : undefined;
  } else if (pendingSelection) {
    effectiveLogo = { Id: '', Kind: pendingSelection.Kind, Source: pendingSelection.Source ?? '', Name: pendingSelection.Name };
  }

  /**
   * Display the source of the logo.
   */
  const renderSource = (): string => {
    switch (effectiveLogo?.Kind) {
      case LogoKinds.Builtin:
        return t('items.logo.sourceBuiltin');
      case LogoKinds.Custom:
        return t('items.logo.sourceCustom');
      case LogoKinds.Favicon:
        return t('items.logo.sourceFavicon', { domain: effectiveLogo.Source });
      default:
        return t('items.logo.sourceNone');
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsPickerOpen(true)}
        title={`${t('items.logo.chooseLogo')} — ${renderSource()}`}
        aria-label={t('items.logo.chooseLogo')}
        className="flex items-center justify-center w-[calc(2.5rem+2px)] h-[calc(2.5rem+2px)] flex-shrink-0 cursor-pointer rounded-md bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 hover:border-primary-500 dark:hover:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors"
      >
        {isFetching ? (
          <svg className="animate-spin w-5 h-5 text-gray-500 dark:text-gray-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        ) : (
          <ItemIconComponent item={{ ...item, LogoInfo: effectiveLogo }} className="w-6 h-6" />
        )}
      </button>

      <LogoPickerModal
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        currentLogo={effectiveLogo}
        onSelect={onSelect}
        onFetchFromWebsite={onFetchFromWebsite}
      />
    </>
  );
};

export default ItemLogoPicker;
