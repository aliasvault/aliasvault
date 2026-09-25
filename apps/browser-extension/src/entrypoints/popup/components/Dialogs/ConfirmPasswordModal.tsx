import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';

type ConfirmPasswordModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (password: string) => Promise<void>;
  title: string;
  message: string;
  confirmText: string;
}

/**
 * A reusable confirmation modal for destructive actions that must be confirmed with the user's master password.
 * The password is handed to the caller for verification; a thrown error is shown inside the modal so the user can retry.
 */
const ConfirmPasswordModal: React.FC<ConfirmPasswordModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText
}) => {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setError(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  /**
   * Hand the entered password to the caller, keeping the modal open with the error when it throws.
   * @param event - the form submit event.
   */
  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (password.length === 0 || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onConfirm(password);
    } catch (confirmError) {
      setError(confirmError instanceof Error && confirmError.message.length > 0 ? confirmError.message : t('common.errors.unknownErrorTryAgain'));
      setIsSubmitting(false);
    }
  };

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      maxWidth="max-w-sm"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-gray-500 dark:text-gray-400">
          {message}
        </p>

        <div>
          <label htmlFor="confirm-master-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('auth.masterPassword')}
          </label>
          <input
            id="confirm-master-password"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            placeholder={t('auth.passwordPlaceholder')}
            className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={isSubmitting || password.length === 0}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
          >
            {confirmText}
          </button>
        </div>
      </form>
    </ModalWrapper>
  );
};

export default ConfirmPasswordModal;
