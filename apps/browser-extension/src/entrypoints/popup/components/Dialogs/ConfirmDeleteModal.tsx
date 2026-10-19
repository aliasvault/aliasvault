import React from 'react';
import { useTranslation } from 'react-i18next';

import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';
import Icon from '@/entrypoints/popup/components/Icons/Icon';

type ConfirmDeleteModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  /** The explanation; omit when the warning says it all. */
  message?: string;
  confirmText: string;
  /** Text shown in an amber warning box under the message. */
  warning?: string;
  /** The confirm button color: red for a destructive action (the default), the brand color otherwise. */
  variant?: 'danger' | 'primary';
}

/**
 * A reusable confirmation modal for actions the user should think twice about, destructive ones by default.
 */
const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  warning,
  variant = 'danger'
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
            className={`px-4 py-2 text-sm text-white rounded ${variant === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-primary-500 hover:bg-primary-600'}`}
          >
            {confirmText}
          </button>
        </div>
      }
    >
      {message && (
        <p className="text-sm text-gray-500 dark:text-gray-400 whitespace-pre-line">
          {message}
        </p>
      )}
      {warning && (
        <div className={`flex gap-2 p-3 border rounded-md text-sm bg-amber-100 dark:bg-amber-500/10 border-amber-300 dark:border-amber-500/40 text-amber-900 dark:text-amber-100 ${message ? 'mt-3' : ''}`}>
          <Icon name="exclamation" className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="whitespace-pre-line">{warning}</p>
        </div>
      )}
    </ModalWrapper>
  );
};

export default ConfirmDeleteModal;
