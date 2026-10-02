import { logoSourceTranslationKey } from '@aliasvault/client/items/ItemLogoView';
import { BuiltinLogoSvgs, getAllBuiltinLogoKeys } from '@aliasvault/models/icons';
import { LogoKinds } from '@aliasvault/models/vault';
import React, { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import ItemIcon from '@/components/items/ItemIcon';
import Icon from '@/components/shared/Icon';
import Modal from '@/components/shared/Modal';

import type { Item, ItemLogo, LogoSelection } from '@aliasvault/models/vault';

type LogoPickerModalProps = {
  item: Item;
  currentLogo?: ItemLogo;
  websiteSource?: string | null;
  onSelect: (selection: LogoSelection) => void;
  onFetchFromWebsite: () => void;
  onClose: () => void;
};

/**
 * Lets the user change an item's icon.
 */
const LogoPickerModal: React.FC<LogoPickerModalProps> = ({ item, currentLogo, websiteSource, onSelect, onFetchFromWebsite, onClose }) => {
  const { t } = useTranslation();

  useEffect(() => {
    /**
     * Escape closes the modal.
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return (): void => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

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
    <Modal id="logoPickerModal" onBackdropClick={onClose} panelClassName="w-full max-w-md flex flex-col max-h-[90vh]">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">{t('items.logo.chooseLogo')}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300" title={t('common.close')} aria-label={t('common.close')}>
            <Icon name="x" className="h-6 w-6" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600">
          <div className="flex items-center justify-center w-10 h-10 flex-shrink-0 rounded-md bg-gray-100 dark:bg-gray-700">
            <ItemIcon item={{ ...item, LogoInfo: currentLogo }} sizeClass="w-7 h-7" />
          </div>
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{t('items.logo.currentLogo')}</div>
            <div className="text-sm text-gray-900 dark:text-white truncate">{describe(currentLogo)}</div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('items.logo.builtinLogos')}</h3>
          <div className="grid grid-cols-5 gap-2">
            {getAllBuiltinLogoKeys().map(key => (
              <button
                key={key}
                type="button"
                title={t(`items.logo.builtin.${key}`)}
                aria-label={t(`items.logo.builtin.${key}`)}
                onClick={() => choose({ Kind: LogoKinds.Builtin, Source: key })}
                className="flex items-center justify-center p-2 rounded-lg border border-gray-200 dark:border-gray-600 transition-colors hover:bg-primary-50 dark:hover:bg-primary-900/30 hover:border-primary-500 dark:hover:border-primary-500"
              >
                <span className="w-8 h-8 inline-block [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: BuiltinLogoSvgs[key] }} />
              </button>
            ))}
          </div>
        </div>

        {/* Only offered when the URL field contains a (valid) URL. */}
        {websiteSource && (
          <button
            type="button"
            onClick={() => choose({ Kind: LogoKinds.Favicon })}
            className="w-full flex items-center gap-3 px-3 py-2 text-left rounded-lg border border-gray-200 dark:border-gray-600 transition-colors hover:bg-primary-50 dark:hover:bg-primary-900/30 hover:border-primary-500 dark:hover:border-primary-500"
          >
            <Icon name="globe-alt" className="w-5 h-5 flex-shrink-0 text-primary-600 dark:text-primary-400" />
            <span className="min-w-0">
              <span className="block text-sm text-gray-900 dark:text-white">
                {currentLogo?.Kind === LogoKinds.Favicon ? t('items.logo.refetchFromWebsite') : t('items.logo.fetchFromWebsite')}
              </span>
              <span className="block text-sm text-gray-500 dark:text-gray-400 truncate">
                {t('items.logo.sourceFavicon', { domain: websiteSource })}
              </span>
            </span>
          </button>
        )}
      </div>
    </Modal>
  );
};

export default LogoPickerModal;
