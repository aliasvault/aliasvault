import React from 'react';

import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';

interface IModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'default';
}

/**
 * A reusable modal component for confirmations and alerts.
 * Built on top of ModalWrapper for consistent behavior.
 */
const Modal: React.FC<IModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = '',
  cancelText = '',
  variant = 'default'
}) => {
  const confirmButtonClass = variant === 'danger'
    ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
    : 'bg-primary-600 hover:bg-primary-700 focus:ring-primary-500';

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="max-w-lg"
      showHeaderBorder={false}
      bodyClassName="px-4 pb-4 pt-5"
    >
      {/* Content */}
      <div className="sm:flex sm:items-start">
        {variant === 'danger' && (
          <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900 sm:mx-0 sm:h-10 sm:w-10">
            <svg className="h-6 w-6 text-red-600 dark:text-red-200" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
        )}
        <div className="mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left">
          <h3 className="text-lg font-semibold leading-6 text-gray-900 dark:text-white">
            {title}
          </h3>
          <div className="mt-2">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {message}
            </p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
        {confirmText && (
          <button
            type="button"
            className={`inline-flex w-full justify-center rounded-md px-3 py-2 text-sm font-semibold text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 sm:ml-3 sm:w-auto ${confirmButtonClass}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        )}
        {cancelText && (
          <button
            type="button"
            className="mt-3 inline-flex w-full justify-center rounded-md bg-white dark:bg-gray-700 px-3 py-2 text-sm font-semibold text-gray-900 dark:text-gray-200 shadow-sm ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500 sm:mt-0 sm:w-auto"
            onClick={onClose}
          >
            {cancelText}
          </button>
        )}
      </div>
    </ModalWrapper>
  );
};

export default Modal;
