import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';

import { AppIconSvgs, getAllAppIconKeys } from '@/utils/dist/core/models/icons';
import type { LogoSelection, ItemLogo } from '@/utils/dist/core/models/vault';
import { LogoKinds } from '@/utils/dist/core/models/vault';

type LogoPickerModalProps = {
  isOpen: boolean;
  onClose: () => void;
  currentLogo?: ItemLogo;
  onSelect: (selection: LogoSelection) => void;
  onFetchFromWebsite: () => void;
};

/**
 * Lets the user change an item's icon.
 */
const LogoPickerModal: React.FC<LogoPickerModalProps> = ({ isOpen, onClose, currentLogo, onSelect, onFetchFromWebsite }) => {
  const { t } = useTranslation();

  /**
   * Apply a choice and close: the item's save is what actually writes it.
   */
  const choose = useCallback((selection: LogoSelection): void => {
    onSelect(selection);
    onClose();
  }, [onSelect, onClose]);

  /**
   * Start the favicon fetch from the website.
   */
  const fetchFromWebsite = useCallback((): void => {
    onFetchFromWebsite();
    onClose();
  }, [onFetchFromWebsite, onClose]);

  return (
    <ModalWrapper isOpen={isOpen} onClose={onClose} title={t('items.logo.chooseLogo')} maxWidth="max-w-md">
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('items.logo.builtinLogos')}</h3>
          <div className="grid grid-cols-5 gap-2">
            {getAllAppIconKeys().map(key => (
              <button
                key={key}
                type="button"
                title={t(`items.logo.builtin.${key}`)}
                onClick={() => choose({ Kind: LogoKinds.Builtin, Source: key })}
                className={`flex items-center justify-center p-2 rounded-lg border transition-colors hover:bg-primary-50 dark:hover:bg-primary-900/30 hover:border-primary-500 dark:hover:border-primary-500 ${
                  currentLogo?.Kind === LogoKinds.Builtin && currentLogo.Source === key
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30'
                    : 'border-gray-200 dark:border-gray-600'
                }`}
              >
                <div className="w-7 h-7" dangerouslySetInnerHTML={{ __html: AppIconSvgs[key] }} />
              </button>
            ))}
          </div>
        </div>

        {/* Fetching is also how an item goes back to the website's icon after a built-in one was picked. */}
        <button
          type="button"
          onClick={fetchFromWebsite}
          className="w-full px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          {currentLogo?.Kind === LogoKinds.Favicon ? t('items.logo.refetchFromWebsite') : t('items.logo.fetchFromWebsite')}
        </button>
      </div>
    </ModalWrapper>
  );
};

export default LogoPickerModal;
