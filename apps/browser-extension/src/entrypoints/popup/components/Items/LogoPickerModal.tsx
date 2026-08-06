import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useVaultMutate } from '@/entrypoints/popup/hooks/useVaultMutate';

import type { CustomLogoEntry } from '@/utils/db/repositories/LogoRepository';
import { AppIconSvgs, getAllAppIconKeys } from '@/utils/dist/core/models/icons';
import type { LogoSelection, ItemLogo } from '@/utils/dist/core/models/vault';
import { LogoKinds } from '@/utils/dist/core/models/vault';
import { LogoImageError, LogoImageService } from '@/utils/LogoImageService';
import SqliteClient from '@/utils/SqliteClient';

type LogoPickerModalProps = {
  isOpen: boolean;
  onClose: () => void;
  currentLogo?: ItemLogo;
  onSelect: (selection: LogoSelection) => void;
};

/**
 * Lets the user change an item's logo.
 */
const LogoPickerModal: React.FC<LogoPickerModalProps> = ({ isOpen, onClose, currentLogo, onSelect }) => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const { executeVaultMutationAsync } = useVaultMutate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [library, setLibrary] = useState<CustomLogoEntry[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isManaging, setIsManaging] = useState(false);

  /**
   * Load the user's custom uploaded logos.
   */
  useEffect(() => {
    if (!isOpen || !dbContext?.sqliteClient) {
      return;
    }
    setUploadError(null);
    setIsManaging(false);
    setLibrary(dbContext.sqliteClient.logos.listCustom());
  }, [isOpen, dbContext?.sqliteClient]);

  /**
   * Apply a choice and close: the item's save is what actually writes it.
   */
  const choose = useCallback((selection: LogoSelection): void => {
    onSelect(selection);
    onClose();
  }, [onSelect, onClose]);

  /**
   * Decode, resize and hand over an uploaded file. The bytes are stored when the item is saved, so
   * cancelling the edit leaves nothing behind.
   */
  const handleFile = useCallback(async (file: File | undefined): Promise<void> => {
    if (!file) {
      return;
    }

    try {
      const prepared = await LogoImageService.prepare(file);
      choose({ Kind: LogoKinds.Custom, Data: prepared.data, MimeType: prepared.mimeType, Name: file.name });
    } catch (error) {
      const reason = error instanceof LogoImageError ? error.reason : 'decodeFailed';
      setUploadError(t(`items.logo.uploadErrors.${reason}`));
    }
  }, [choose, t]);

  /**
   * Remove a custom logo from the library.
   */
  const handleDelete = useCallback(async (logoId: string): Promise<void> => {
    if (!dbContext?.sqliteClient) {
      return;
    }

    try {
      await executeVaultMutationAsync(async () => {
        dbContext.sqliteClient!.logos.deleteById(logoId, new Date().toISOString());
      });
      setLibrary(dbContext.sqliteClient.logos.listCustom());
    } catch (error) {
      console.error('Error deleting logo:', error);
    }
  }, [dbContext?.sqliteClient, executeVaultMutationAsync]);

  /**
   * Whether a choice is the one the item shows today, so it reads as selected.
   */
  const isCurrent = (kind: string, source: string): boolean => currentLogo?.Kind === kind && currentLogo?.Source === source;

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
                className={`flex items-center justify-center p-2 rounded-lg border transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${
                  isCurrent(LogoKinds.Builtin, key)
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30'
                    : 'border-gray-200 dark:border-gray-600'
                }`}
              >
                <div className="w-7 h-7" dangerouslySetInnerHTML={{ __html: AppIconSvgs[key] }} />
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('items.logo.yourLogos')}</h3>
            {library.length > 0 && (
              <button
                type="button"
                onClick={() => setIsManaging(prev => !prev)}
                className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
              >
                {isManaging ? t('common.cancel') : t('items.logo.manage')}
              </button>
            )}
          </div>
          <div className="grid grid-cols-5 gap-2">
            {library.map(logo => {
              const src = logo.FileData ? SqliteClient.imgSrcFromBytes(logo.FileData) : null;
              return src ? (
                <div key={logo.Id} className="relative">
                  <button
                    type="button"
                    title={logo.Name ?? undefined}
                    onClick={() => choose({ Kind: LogoKinds.Custom, Source: logo.Source })}
                    className={`w-full flex items-center justify-center p-2 rounded-lg border transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${
                      isCurrent(LogoKinds.Custom, logo.Source)
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30'
                        : 'border-gray-200 dark:border-gray-600'
                    }`}
                  >
                    <img src={src} alt={logo.Name ?? ''} className="w-7 h-7 object-contain" />
                  </button>
                  {isManaging && (
                    <button
                      type="button"
                      title={t('common.delete')}
                      onClick={() => void handleDelete(logo.Id)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center rounded-full bg-red-600 text-white text-xs hover:bg-red-700"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ) : null;
            })}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center p-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 hover:text-primary-500 hover:border-primary-500 transition-colors"
              title={t('items.logo.uploadLogo')}
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={LogoImageService.acceptAttribute}
            className="hidden"
            onChange={(e) => {
              void handleFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{t('items.logo.uploadHint')}</p>
          {uploadError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{uploadError}</p>}
        </div>

        <button
          type="button"
          onClick={() => choose({ Kind: LogoKinds.Favicon })}
          className="w-full px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          {t('items.logo.useAutomatic')}
        </button>
      </div>
    </ModalWrapper>
  );
};

export default LogoPickerModal;
