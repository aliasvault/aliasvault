import React from 'react';
import { useTranslation } from 'react-i18next';

import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';

type ConfirmDeleteModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText: string;
}

/**
 * A reusable confirmation modal for delete actions.
 * Uses the danger styling to indicate a destructive action.
 */
const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText
}) => {
  const { t } = useTranslation();

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      maxWidth="max-w-sm"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700"
          >
            {confirmText}
          </button>
        </div>
      }
    >
      <p className="text-gray-500 dark:text-gray-400">
        {message}
      </p>
    </ModalWrapper>
  );
};

export default ConfirmDeleteModal;
