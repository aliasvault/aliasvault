import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';
import Icon from '@/entrypoints/popup/components/Icons/Icon';

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
  const { t } = useTranslation();
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className={`${className}`}
        type="button"
        aria-label={t('common.help')}
      >
        <Icon name="question-mark-circle" className="w-4 h-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-help" />
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
