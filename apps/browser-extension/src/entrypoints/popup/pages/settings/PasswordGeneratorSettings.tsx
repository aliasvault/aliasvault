import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';
import PasswordConfigForm from '@/entrypoints/popup/components/Forms/PasswordConfigForm';
import PageTitle from '@/entrypoints/popup/components/PageTitle';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { usePasswordConfig } from '@/entrypoints/popup/hooks/usePasswordConfig';
import { useVaultMutate } from '@/entrypoints/popup/hooks/useVaultMutate';

import type { PasswordSettings } from '@/utils/dist/core/models/vault';

interface IPasswordSettingsModalProps {
  isOpen: boolean;
  initialSettings: PasswordSettings;
  onSave: (settings: PasswordSettings) => void;
  onClose: () => void;
}

/**
 * Modal that edits the default password generator settings.
 */
const PasswordSettingsModal: React.FC<IPasswordSettingsModalProps> = ({ isOpen, initialSettings, onSave, onClose }) => {
  const { t } = useTranslation();
  const {
    settings,
    previewPassword,
    dicewareLanguages,
    handleSettingChange,
    handleRefreshPreview,
    reset
  } = usePasswordConfig(initialSettings);

  // Re-seed the draft from the latest settings each time the modal is opened.
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
    onSave(settings);
    onClose();
  }, [settings, onSave, onClose]);

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
            className="inline-flex w-full items-center justify-center gap-1 rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-700"
            onClick={handleSave}
          >
            {t('common.save')}
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

/**
 * Password Generator Settings page.
 * Configures the default password generator settings (basic and Diceware/passphrase, including the
 * passphrase language) used for all newly created items. Settings are edited in a modal that only
 * persists on Save, avoiding a vault write + sync on every adjustment.
 */
const PasswordGeneratorSettings: React.FC = () => {
  const { t } = useTranslation();
  const { setIsInitialLoading } = useLoading();
  const dbContext = useDb();
  const { executeVaultMutationAsync } = useVaultMutate();

  const [settings, setSettings] = useState<PasswordSettings | null>(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (dbContext?.sqliteClient) {
      setSettings(dbContext.sqliteClient.settings.getPasswordSettings());
    }
    setIsInitialLoading(false);
  }, [dbContext?.sqliteClient, setIsInitialLoading]);

  /**
   * Persist the full settings blob to the vault (a single write + sync).
   */
  const handleModalSave = useCallback((next: PasswordSettings): void => {
    setSettings(next);
    if (dbContext?.sqliteClient) {
      void executeVaultMutationAsync(async () => {
        dbContext.sqliteClient!.settings.setPasswordSettings(next);
      }, { scope: 'Settings' });
    }
  }, [dbContext?.sqliteClient, executeVaultMutationAsync]);

  return (
    <div className="space-y-6">
      <PageTitle>{t('settings.passwordGenerator')}</PageTitle>

      <section>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="p-4">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              {t('settings.passwordGeneratorSettings.description')}
            </p>
            <button
              type="button"
              onClick={() => setShowModal(true)}
              disabled={!settings}
              className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
            >
              {t('settings.passwordGeneratorSettings.configureButton')}
            </button>
          </div>
        </div>
      </section>

      {settings && showModal && (
        <PasswordSettingsModal
          isOpen={showModal}
          initialSettings={settings}
          onSave={handleModalSave}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
};

export default PasswordGeneratorSettings;
