import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import LogoPickerModal from '@/entrypoints/popup/components/Items/LogoPickerModal';

import type { DraftItem } from '@/utils/db/ItemRef';
import { getAppIconSvg } from '@/utils/dist/core/models/icons';
import type { LogoSelection, ItemLogo } from '@/utils/dist/core/models/vault';
import { LogoKinds } from '@/utils/dist/core/models/vault';
import SqliteClient from '@/utils/SqliteClient';

import ItemIconComponent from './ItemIcon';

type ItemLogoPickerProps = {
  item: DraftItem;
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
      return <img src={pendingPreview} alt="" className="w-6 h-6 object-contain" />;
    }
    if (effectiveLogo?.Kind === LogoKinds.Builtin) {
      const svg = getAppIconSvg(effectiveLogo.Source);
      if (svg) {
        return <div className="w-6 h-6" dangerouslySetInnerHTML={{ __html: svg }} />;
      }
    }
    if (effectiveLogo?.Kind === LogoKinds.Custom) {
      const src = item.Logo ? SqliteClient.imgSrcFromBytes(item.Logo) : null;
      if (src) {
        return <img src={src} alt="" className="w-6 h-6 object-contain" />;
      }
    }
    return <ItemIconComponent item={{ ...item, LogoInfo: effectiveLogo }} className="w-6 h-6" />;
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
      <button
        type="button"
        onClick={() => setIsPickerOpen(true)}
        title={`${t('items.logo.chooseLogo')} — ${renderProvenance()}`}
        aria-label={t('items.logo.chooseLogo')}
        className="group relative flex items-center justify-center w-[calc(2.5rem+2px)] h-[calc(2.5rem+2px)] flex-shrink-0 cursor-pointer rounded-md bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600 hover:border-primary-500 dark:hover:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors"
      >
        {renderPreview()}
        {/* Hovering dims the logo and reveals a full-size pencil, so the click target reads as "edit" without a badge too small to recognise. */}
        <span className="absolute inset-0 flex items-center justify-center rounded-md bg-gray-900/60 text-white opacity-0 group-hover:opacity-100 transition-opacity">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </span>
      </button>

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
