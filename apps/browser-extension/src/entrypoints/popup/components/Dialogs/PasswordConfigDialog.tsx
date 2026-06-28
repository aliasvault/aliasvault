import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';
import PasswordConfigForm from '@/entrypoints/popup/components/Forms/PasswordConfigForm';
import { usePasswordConfig } from '@/entrypoints/popup/hooks/usePasswordConfig';

import type { PasswordSettings } from '@/utils/dist/core/models/vault';

interface IPasswordConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (password: string) => void;
  onSettingsChange?: (settings: PasswordSettings) => void;
  initialSettings: PasswordSettings;
}

/**
 * Password configuration dialog component.
 */
const PasswordConfigDialog: React.FC<IPasswordConfigDialogProps> = ({
  isOpen,
  onClose,
  onSave,
  onSettingsChange,
  initialSettings
}) => {
  const { t } = useTranslation();
  const {
    settings,
    previewPassword,
    dicewareLanguages,
    handleSettingChange,
    handleRefreshPreview,
    reset
  } = usePasswordConfig(initialSettings, onSettingsChange);

  /*
   * Re-initialize the working settings + seed each time the dialog is opened so it reflects the
   * latest persisted settings and produces a fresh preview.
   */
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      reset({ ...initialSettings });
    } else if (!isOpen) {
      wasOpenRef.current = false;
    }
  }, [isOpen, initialSettings, reset]);

  const handleSave = useCallback(() => {
    onSave(previewPassword);
    onClose();
  }, [previewPassword, onSave, onClose]);

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      showCloseButton={false}
      maxWidth="max-w-lg"
      footer={
        <div className="flex">
          <button
            type="button"
            className="inline-flex w-full items-center justify-center gap-1 rounded-md bg-gray-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-gray-500"
            onClick={handleSave}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13l-3 3m0 0l-3-3m3 3V8m0 13a9 9 0 110-18 9 9 0 010 18z" />
            </svg>
            {t('common.use')}
          </button>
        </div>
      }
    >
      <PasswordConfigForm
        settings={settings}
        previewPassword={previewPassword}
        dicewareLanguages={dicewareLanguages}
        onSettingChange={handleSettingChange}
        onRefreshPreview={handleRefreshPreview}
      />
    </ModalWrapper>
  );
};

export default PasswordConfigDialog;
