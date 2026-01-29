import React, { useState } from 'react';

import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';

type HelpModalProps = {
  title: string;
  content: string;
  className?: string;
}

/**
 * Reusable help modal component with a question mark icon button.
 * Shows a modal popup with help information when clicked.
 */
const HelpModal: React.FC<HelpModalProps> = ({ title, content, className = '' }) => {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className={`${className}`}
        type="button"
        aria-label="Help"
      >
        <svg
          className="w-4 h-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-help"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </button>

      <ModalWrapper
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={title}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {content}
        </p>
      </ModalWrapper>
    </>
  );
};

export default HelpModal;
