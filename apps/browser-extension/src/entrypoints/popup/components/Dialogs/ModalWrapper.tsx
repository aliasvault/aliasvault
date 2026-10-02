import React, { useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '@/entrypoints/popup/components/Icons/Icon';

type ModalWrapperProps = {
  isOpen: boolean;
  onClose: () => void;
  /** Modal title (optional - if not provided, no header is shown) */
  title?: string;
  children: React.ReactNode;
  /** Optional max-width class (default: 'max-w-md') */
  maxWidth?: string;
  /** Whether to show the close button in header (default: true) */
  showCloseButton?: boolean;
  /** Optional footer actions */
  footer?: React.ReactNode;
  /** Whether to show header border (default: true) */
  showHeaderBorder?: boolean;
  /** Custom body padding class (default: 'px-6 py-4') */
  bodyClassName?: string;
};

/**
 * A generic modal wrapper component that provides consistent behavior:
 * - Click outside to close (on backdrop)
 * - Escape key to close
 */
const ModalWrapper: React.FC<ModalWrapperProps> = ({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = 'max-w-md',
  showCloseButton = true,
  footer,
  showHeaderBorder = true,
  bodyClassName = 'px-6 py-4'
}) => {
  const { t } = useTranslation();

  /**
   * Handle escape key press to close modal.
   */
  const handleKeyDown = useCallback((e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  /**
   * Add/remove escape key listener when modal opens/closes.
   */
  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return (): void => {
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) {
    return null;
  }

  /**
   * Handle mousedown on the container (outside modal content) to close.
   */
  const handleContainerMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    // Only close if the press started directly on the container, not the modal content
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="fixed inset-0 bg-gray-600/50 backdrop-blur-sm dark:bg-black/70" />
      <div className="fixed inset-0 overflow-y-auto">
        {/* Pressing outside the panel closes the modal */}
        <div className="flex min-h-full items-center justify-center p-4" onMouseDown={handleContainerMouseDown}>
          <div className={`relative overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-800 dark:shadow-2xl w-full ${maxWidth}`}>
            {/* Header */}
            {title && (
              <div className={`px-6 py-4 flex items-center justify-between ${showHeaderBorder ? 'border-b border-gray-200 dark:border-gray-700' : ''}`}>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  {title}
                </h2>
                {showCloseButton && (
                  <button
                    type="button"
                    className="text-gray-400 hover:text-gray-500 focus:outline-none"
                    onClick={onClose}
                  >
                    <span className="sr-only">{t('common.close')}</span>
                    <Icon name="x" className="h-6 w-6" strokeWidth={1.5} />
                  </button>
                )}
              </div>
            )}

            {/* Floating close button when no title */}
            {!title && showCloseButton && (
              <button
                type="button"
                className="absolute top-3 right-3 text-gray-400 hover:text-gray-500 focus:outline-none z-10"
                onClick={onClose}
              >
                <span className="sr-only">{t('common.close')}</span>
                <Icon name="x" className="h-6 w-6" strokeWidth={1.5} />
              </button>
            )}

            {/* Body */}
            <div className={bodyClassName}>
              {children}
            </div>

            {/* Footer */}
            {footer && (
              <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700">
                {footer}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalWrapper;
