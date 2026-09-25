import { logoSourceTranslationKey } from '@aliasvault/client/items/ItemLogoView';
import { AppIconSvgs, getAllAppIconKeys } from '@aliasvault/models/icons';
import { LogoKinds } from '@aliasvault/models/vault';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';

import ItemIconComponent from './ItemIcon';

import type { Item, LogoSelection, ItemLogo } from '@aliasvault/models/vault';

type LogoPickerModalProps = {
  isOpen: boolean;
  onClose: () => void;
  item: Item;
  currentLogo?: ItemLogo;
  websiteSource?: string | null;
  onSelect: (selection: LogoSelection) => void;
  onFetchFromWebsite: () => void;
};

/**
 * Lets the user change an item's icon.
 */
const LogoPickerModal: React.FC<LogoPickerModalProps> = ({ isOpen, onClose, item, currentLogo, websiteSource, onSelect, onFetchFromWebsite }) => {
  const { t } = useTranslation();

  /**
   * Apply a choice and close: the item's save is what actually writes it.
   */
  const choose = useCallback((selection: LogoSelection): void => {
    if (selection.Kind === LogoKinds.Favicon) {
      onFetchFromWebsite();
    } else {
      onSelect(selection);
    }
    onClose();
  }, [onFetchFromWebsite, onSelect, onClose]);

  /**
   * Describe a logo: a library icon by its name, any other by where it comes from.
   */
  const describe = (logo: ItemLogo | undefined): string => {
    return logo?.Kind === LogoKinds.Builtin ? t(`items.logo.builtin.${logo.Source}`) : t(logoSourceTranslationKey(logo), { domain: logo?.Source });
  };

  return (
    <ModalWrapper isOpen={isOpen} onClose={onClose} title={t('items.logo.chooseLogo')} maxWidth="max-w-md">
      <div className="space-y-4">
        {/* What the item shows now; a click below replaces it once the item is saved. */}
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600">
          <div className="flex items-center justify-center w-10 h-10 flex-shrink-0 rounded-md bg-gray-100 dark:bg-gray-700">
            <ItemIconComponent item={{ ...item, LogoInfo: currentLogo }} className="w-7 h-7" />
          </div>
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('items.logo.currentLogo')}</div>
            <div className="text-sm text-gray-900 dark:text-white truncate">{describe(currentLogo)}</div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('items.logo.builtinLogos')}</h3>
          <div className="grid grid-cols-5 gap-2">
            {getAllAppIconKeys().map(key => (
              <button
                key={key}
                type="button"
                title={t(`items.logo.builtin.${key}`)}
                onClick={() => choose({ Kind: LogoKinds.Builtin, Source: key })}
                className="flex items-center justify-center p-2 rounded-lg border border-gray-200 dark:border-gray-600 transition-colors hover:bg-primary-50 dark:hover:bg-primary-900/30 hover:border-primary-500 dark:hover:border-primary-500"
              >
                <div className="w-7 h-7" dangerouslySetInnerHTML={{ __html: AppIconSvgs[key] }} />
              </button>
            ))}
          </div>
        </div>

        {/* Only offered when the URL field names a website; fetching is also how an item goes back to the website's icon after a built-in one was picked. */}
        {websiteSource && (
          <button
            type="button"
            onClick={() => choose({ Kind: LogoKinds.Favicon })}
            className="w-full flex items-center gap-3 px-3 py-2 text-left rounded-lg border border-gray-200 dark:border-gray-600 transition-colors hover:bg-primary-50 dark:hover:bg-primary-900/30 hover:border-primary-500 dark:hover:border-primary-500"
          >
            <svg className="w-5 h-5 flex-shrink-0 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18zm0 0a8.95 8.95 0 003.2-9 8.95 8.95 0 00-3.2-9m0 18a8.95 8.95 0 01-3.2-9A8.95 8.95 0 0112 3m-8.7 6h17.4M3.3 15h17.4" /></svg>
            <span className="min-w-0">
              <span className="block text-sm text-gray-900 dark:text-white">
                {currentLogo?.Kind === LogoKinds.Favicon ? t('items.logo.refetchFromWebsite') : t('items.logo.fetchFromWebsite')}
              </span>
              <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">
                {t('items.logo.sourceFavicon', { domain: websiteSource })}
              </span>
            </span>
          </button>
        )}
      </div>
    </ModalWrapper>
  );
};

export default LogoPickerModal;
