import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FormModal from '@/components/shared/FormModal';

type FolderModalProps = {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initialName?: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
};

/**
 * Modal for creating or renaming a folder.
 */
const FolderModal: React.FC<FolderModalProps> = ({ isOpen, mode, initialName = '', onClose, onSave }) => {
  const { t } = useTranslation();
  const [folderName, setFolderName] = useState(initialName);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setFolderName(initialName);
      setErrorMessage('');
      setIsSaving(false);
    }
  }, [isOpen, initialName]);

  /**
   * Validate and save.
   */
  const handleSave = async (): Promise<void> => {
    const trimmedName = folderName.trim();
    if (trimmedName.length === 0) {
      setErrorMessage(t('components.folders.folderModal.FolderNameRequired'));
      return;
    }

    setIsSaving(true);
    setErrorMessage('');
    try {
      await onSave(trimmedName);
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <FormModal
      isOpen={isOpen}
      title={mode === 'create' ? t('components.folders.folderModal.CreateFolderTitle') : t('components.folders.folderModal.EditFolderTitle')}
      confirmText={mode === 'create' ? t('components.folders.folderModal.CreateButton') : t('components.folders.folderModal.SaveButton')}
      cancelText={t('components.folders.folderModal.CancelButton')}
      isLoading={isSaving}
      confirmDisabled={folderName.trim().length === 0}
      onClose={onClose}
      onConfirm={handleSave}
      icon={(
        <svg className="h-6 w-6 text-orange-600 dark:text-orange-400" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
        </svg>
      )}>
      <label htmlFor="folder-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {t('components.folders.folderModal.FolderNameLabel')}
      </label>
      <input
        type="text"
        id="folder-name"
        value={folderName}
        onChange={(e) => setFolderName(e.target.value)}
        placeholder={t('components.folders.folderModal.FolderNamePlaceholder')}
        autoFocus
        className="block w-full rounded-md border-0 py-2 px-3 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-orange-600 sm:text-sm sm:leading-6 dark:bg-gray-700 dark:text-white dark:ring-gray-600 dark:placeholder:text-gray-500 dark:focus:ring-orange-500" />
      {errorMessage && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
      )}
    </FormModal>
  );
};

export default FolderModal;
