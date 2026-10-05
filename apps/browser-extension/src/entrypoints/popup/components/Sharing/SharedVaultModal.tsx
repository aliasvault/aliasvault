import { hasErrorCode, getErrorMessage } from '@aliasvault/client/api/errors/AppErrorCodes';
import { familySharingText, MAX_SHARED_VAULT_NAME_LENGTH } from '@aliasvault/client/sharing/FamilySharingView';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';

import { logFailure } from '@/utils/Diagnostics';

type SharedVaultModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
  initialName?: string;
  mode: 'create' | 'rename';
};

/**
 * Modal for creating or renaming a shared vault.
 */
const SharedVaultModal: React.FC<SharedVaultModalProps> = ({ isOpen, onClose, onSave, initialName = '', mode }) => {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmedName = name.trim();

  useEffect(() => {
    if (isOpen) {
      setName(initialName);
      setError(null);
    }
  }, [isOpen, initialName]);

  /**
   * Save the name and close.
   */
  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!trimmedName || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onSave(trimmedName);
      onClose();
    } catch (err) {
      setError(hasErrorCode(err) ? getErrorMessage(err, t('common.errors.unknownErrorTryAgain')) : t('common.errors.unknownErrorTryAgain'));
      logFailure('Error saving shared vault', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'create' ? familySharingText.createSharedVault : familySharingText.renameVault}
      footer={
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="shared-vault-form"
            disabled={isSubmitting || !trimmedName}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
          >
            {isSubmitting ? t('common.saving') : mode === 'create' ? familySharingText.create : t('common.save')}
          </button>
        </div>
      }
    >
      <form id="shared-vault-form" onSubmit={handleSubmit}>
        <label htmlFor="sharedVaultName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {familySharingText.vaultName}
        </label>
        <input
          id="sharedVaultName"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={familySharingText.vaultNamePlaceholder}
          maxLength={MAX_SHARED_VAULT_NAME_LENGTH}
          autoFocus
          className="w-full p-2 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
        />
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </form>
    </ModalWrapper>
  );
};

export default SharedVaultModal;
