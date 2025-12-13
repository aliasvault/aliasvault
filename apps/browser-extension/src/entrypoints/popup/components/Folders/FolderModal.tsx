import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

type FolderModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (folderName: string) => Promise<void>;
  initialName?: string;
  mode: 'create' | 'edit';
};

/**
 * Modal for creating or editing a folder
 */
const FolderModal: React.FC<FolderModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialName = '',
  mode
}) => {
  const { t } = useTranslation();
  const [folderName, setFolderName] = useState(initialName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setFolderName(initialName);
      setError(null);
    }
  }, [isOpen, initialName]);

  /**
   * Handle the form submission.
   */
  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();

    const trimmedName = folderName.trim();
    if (!trimmedName) {
      setError(t('items.folderNameRequired'));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onSave(trimmedName);
      onClose();
    } catch (err) {
      setError(t('items.folderSaveError'));
      console.error('Error saving folder:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Handle the escape key press.
   */
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            {mode === 'create' ? t('items.createFolder') : t('items.editFolder')}
          </h2>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4">
            <label
              htmlFor="folderName"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              {t('items.folderName')}
            </label>
            <input
              id="folderName"
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder={t('items.folderNamePlaceholder')}
              autoFocus
              className="w-full p-2 border dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-blue-500 focus:border-blue-500"
            />
            {error && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 rounded focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50"
            >
              {isSubmitting
                ? t('common.saving')
                : mode === 'create'
                  ? t('common.create')
                  : t('common.save')
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default FolderModal;
