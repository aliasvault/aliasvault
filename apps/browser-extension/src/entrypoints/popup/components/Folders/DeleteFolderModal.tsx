import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

type DeleteFolderModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onDeleteFolderOnly: () => Promise<void>;
  onDeleteFolderAndContents: () => Promise<void>;
  folderName: string;
  itemCount: number;
};

/**
 * Modal for deleting a folder with options to keep or delete contents
 */
const DeleteFolderModal: React.FC<DeleteFolderModalProps> = ({
  isOpen,
  onClose,
  onDeleteFolderOnly,
  onDeleteFolderAndContents,
  folderName,
  itemCount
}) => {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * Handle delete folder only (move items to root)
   */
  const handleDeleteFolderOnly = async (): Promise<void> => {
    setIsSubmitting(true);
    try {
      await onDeleteFolderOnly();
      onClose();
    } catch (err) {
      console.error('Error deleting folder:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Handle delete folder and all contents
   */
  const handleDeleteFolderAndContents = async (): Promise<void> => {
    setIsSubmitting(true);
    try {
      await onDeleteFolderAndContents();
      onClose();
    } catch (err) {
      console.error('Error deleting folder with contents:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Handle escape key press
   */
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape' && !isSubmitting) {
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
            {t('items.deleteFolder')}
          </h2>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          <p className="text-gray-700 dark:text-gray-300">
            {t('items.deleteFolderConfirm', { folderName })}
          </p>

          {itemCount > 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('items.folderContainsItems', { count: itemCount })}
            </p>
          )}

          {/* Option buttons */}
          <div className="space-y-3 pt-2">
            {/* Delete folder only - move items to root */}
            <button
              type="button"
              onClick={handleDeleteFolderOnly}
              disabled={isSubmitting}
              className="w-full p-3 text-left border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 text-orange-500">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l2 2 4-4" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">
                    {t('items.deleteFolderKeepItems')}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t('items.deleteFolderKeepItemsDescription')}
                  </p>
                </div>
              </div>
            </button>

            {/* Delete folder and contents */}
            {itemCount > 0 && (
              <button
                type="button"
                onClick={handleDeleteFolderAndContents}
                disabled={isSubmitting}
                className="w-full p-3 text-left border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 text-red-500">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-red-600 dark:text-red-400">
                      {t('items.deleteFolderAndItems')}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {t('items.deleteFolderAndItemsDescription', { count: itemCount })}
                    </p>
                  </div>
                </div>
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteFolderModal;
