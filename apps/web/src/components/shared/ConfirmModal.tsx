import React, { useEffect } from 'react';

import Modal from '@/components/shared/Modal';

type ConfirmModalProps = {
  title: string;
  message: string;
  confirmText: string;
  /** Omit for a dialog that only informs. */
  cancelText?: string;
  onClose: (confirmed: boolean) => void;
};

/**
 * Confirm dialog. A backdrop click or Escape counts as cancel.
 */
const ConfirmModal: React.FC<ConfirmModalProps> = ({ title, message, confirmText, cancelText, onClose }) => {
  useEffect(() => {
    /**
     * Escape cancels. Caught before it reaches the document, so a modal underneath does not close too.
     */
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose(false);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return (): void => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return (
    <Modal id="confirm-modal" zIndexClass="z-[1000]" panelClassName="p-5 w-96 max-w-full" onBackdropClick={() => onClose(false)}>
      <div className="mt-3 text-center">
        <h3 className="text-lg leading-6 font-medium text-gray-900 dark:text-white">{title}</h3>
        <div className="mt-2 px-7 py-3">
          <p className="text-sm text-gray-500 dark:text-gray-300">
            {message.split('\n').map((line, index) => (
              <React.Fragment key={index}>
                {index > 0 && <br />}
                {line}
              </React.Fragment>
            ))}
          </p>
        </div>
        <div className="items-center px-4 py-3">
          <button id="confirmButton" className="px-4 py-2 bg-primary-500 text-white text-base font-medium rounded-md w-full shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300 dark:bg-primary-600 dark:hover:bg-primary-700 dark:focus:ring-primary-800" onClick={() => onClose(true)}>
            {confirmText}
          </button>
          {cancelText && (
            <button id="cancelButton" className="mt-3 px-4 py-2 bg-gray-300 text-gray-800 text-base font-medium rounded-md w-full shadow-sm hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300 dark:bg-gray-500 dark:text-white dark:hover:bg-gray-600 dark:focus:ring-gray-400" onClick={() => onClose(false)}>
              {cancelText}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default ConfirmModal;
