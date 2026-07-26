import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import LogoPickerModal from '@/entrypoints/popup/components/Items/LogoPickerModal';

import { getAppIconSvg } from '@/utils/dist/core/models/icons';
import type { LogoSelection, Item, ItemLogo } from '@/utils/dist/core/models/vault';
import { LogoKinds } from '@/utils/dist/core/models/vault';
import SqliteClient from '@/utils/SqliteClient';

import ItemIconComponent from './ItemIcon';

type ItemLogoPickerProps = {
  item: Item;
  pendingSelection?: LogoSelection;
  pendingPreview?: string | null;
  onSelect: (selection: LogoSelection) => void;
};

/**
 * The item's logo on the edit screen: shows what the item will look like and allows to opens the picker.
 */
const ItemLogoPicker: React.FC<ItemLogoPickerProps> = ({ item, pendingSelection, pendingPreview, onSelect }) => {
  const { t } = useTranslation();
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  /*
   * What the item will show once saved: an unsaved choice takes precedence over the stored logo, so
   * the preview matches the outcome rather than the past.
   */
  const effectiveLogo: ItemLogo | undefined = pendingSelection && pendingSelection.Kind !== LogoKinds.Favicon
    ? { Id: '', Kind: pendingSelection.Kind, Source: pendingSelection.Source ?? '', Name: pendingSelection.Name }
    : (pendingSelection ? undefined : item.LogoInfo);

  /**
   * Render the logo preview, favouring an upload that has not been stored yet.
   */
  const renderPreview = (): React.ReactNode => {
    if (pendingPreview) {
      return <img src={pendingPreview} alt="" className="w-8 h-8 object-contain" />;
    }
    if (effectiveLogo?.Kind === LogoKinds.Builtin) {
      const svg = getAppIconSvg(effectiveLogo.Source);
      if (svg) {
        return <div className="w-8 h-8" dangerouslySetInnerHTML={{ __html: svg }} />;
      }
    }
    if (effectiveLogo?.Kind === LogoKinds.Custom) {
      const src = item.Logo ? SqliteClient.imgSrcFromBytes(item.Logo) : null;
      if (src) {
        return <img src={src} alt="" className="w-8 h-8 object-contain" />;
      }
    }
    return <ItemIconComponent item={{ ...item, LogoInfo: effectiveLogo }} className="w-8 h-8" />;
  };

  /**
   * One line saying where this logo comes from, so an automatic logo is never mistaken for a choice.
   */
  const renderProvenance = (): string => {
    if (pendingSelection?.Kind === LogoKinds.Custom && pendingSelection.Data) {
      return t('items.logo.sourceUploaded');
    }
    switch (effectiveLogo?.Kind) {
      case LogoKinds.Builtin:
        return t('items.logo.sourceBuiltin');
      case LogoKinds.Custom:
        return effectiveLogo.Name ? t('items.logo.sourceUploadedNamed', { name: effectiveLogo.Name }) : t('items.logo.sourceUploaded');
      case LogoKinds.Favicon:
        return t('items.logo.sourceFavicon', { domain: effectiveLogo.Source });
      default:
        return t('items.logo.sourceNone');
    }
  };

  return (
    <>
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-700 flex-shrink-0">
          {renderPreview()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('items.logo.logo')}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{renderProvenance()}</p>
        </div>
        <button
          type="button"
          onClick={() => setIsPickerOpen(true)}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          {t('items.logo.change')}
        </button>
      </div>

      <LogoPickerModal
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        currentLogo={effectiveLogo}
        onSelect={onSelect}
      />
    </>
  );
};

export default ItemLogoPicker;
