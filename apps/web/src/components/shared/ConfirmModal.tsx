import React from 'react';

type ConfirmModalProps = {
  title: string;
  message: string;
  confirmText: string;
  /** Omit for a dialog that only informs. */
  cancelText?: string;
  onClose: (confirmed: boolean) => void;
};

/**
 * Confirm dialog.
 */
const ConfirmModal: React.FC<ConfirmModalProps> = ({ title, message, confirmText, cancelText, onClose }) => (
  <div id="confirm-modal" className="fixed inset-0 z-[1000] bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full flex items-center justify-center">
    <div className="relative p-5 border w-96 shadow-lg rounded-md bg-white">
      <div className="mt-3 text-center">
        <h3 className="text-lg leading-6 font-medium text-gray-900">{title}</h3>
        <div className="mt-2 px-7 py-3">
          <p className="text-sm text-gray-500">
            {message.split('\n').map((line, index) => (
              <React.Fragment key={index}>
                {index > 0 && <br />}
                {line}
              </React.Fragment>
            ))}
          </p>
        </div>
        <div className="items-center px-4 py-3">
          <button id="confirmButton" className="px-4 py-2 bg-primary-500 text-white text-base font-medium rounded-md w-full shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300" onClick={() => onClose(true)}>
            {confirmText}
          </button>
          {cancelText && (
            <button id="cancelButton" className="mt-3 px-4 py-2 bg-gray-300 text-gray-800 text-base font-medium rounded-md w-full shadow-sm hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300" onClick={() => onClose(false)}>
              {cancelText}
            </button>
          )}
        </div>
      </div>
    </div>
  </div>
);

export default ConfirmModal;
