import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '@/components/shared/Icon';
import Modal from '@/components/shared/Modal';

type FormModalProps = {
  isOpen: boolean;
  title?: string;
  icon?: React.ReactNode;
  iconBackgroundClass?: string;
  children?: React.ReactNode;
  footerContent?: React.ReactNode;
  showDefaultFooter?: boolean;
  confirmText?: string;
  cancelText?: string;
  confirmDisabled?: boolean;
  confirmButtonClass?: string;
  isLoading?: boolean;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  submitOnEnter?: boolean;
  onClose: () => void;
  onConfirm?: () => void;
};

/**
 * The max width class of the modal panel.
 * @param maxWidth - the size
 */
const getMaxWidthClass = (maxWidth: FormModalProps['maxWidth']): string => {
  switch (maxWidth) {
    case 'sm': return 'sm:max-w-sm';
    case 'md': return 'sm:max-w-md';
    case 'xl': return 'sm:max-w-xl';
    case '2xl': return 'sm:max-w-2xl';
    default: return 'sm:max-w-lg';
  }
};

/**
 * Generic modal for forms and content.
 */
const FormModal: React.FC<FormModalProps> = ({
  isOpen, title = '', icon, iconBackgroundClass = 'bg-primary-100 dark:bg-primary-900/30', children, footerContent, showDefaultFooter = true,
  confirmText, cancelText, confirmDisabled = false, confirmButtonClass = 'bg-primary-600 hover:bg-primary-700', isLoading = false, maxWidth = 'lg',
  closeOnOverlayClick = true, closeOnEscape = true, submitOnEnter = true, onClose, onConfirm,
}) => {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus the panel for keyboard handling, unless a field inside it already took focus via autoFocus.
  useEffect(() => {
    if (isOpen && !panelRef.current?.contains(document.activeElement)) {
      panelRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  /**
   * Escape closes, Enter confirms.
   */
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape' && closeOnEscape) {
      onClose();
    } else if (e.key === 'Enter' && submitOnEnter && !confirmDisabled && !isLoading && onConfirm) {
      onConfirm();
    }
  };

  return (
    <Modal panelRef={panelRef} tabIndex={0} onKeyDown={handleKeyDown} onBackdropClick={closeOnOverlayClick ? onClose : undefined} panelClassName={`w-full overflow-hidden text-left outline-none ${getMaxWidthClass(maxWidth)}`}>
      <div className="px-4 pb-4 pt-5 sm:p-6">
        <div className="sm:flex sm:items-start">
          {icon && (
            <div className={`mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full ${iconBackgroundClass} sm:mx-0 sm:h-10 sm:w-10`}>
              {icon}
            </div>
          )}
          <div className={`${icon ? 'mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left' : ''} flex-1`}>
            {title && (
              <h3 className="text-lg font-semibold leading-6 text-gray-900 dark:text-white">
                {title}
              </h3>
            )}
            <div className={title ? 'mt-4' : ''}>
              {children}
            </div>
          </div>
        </div>

        {footerContent ? (
          <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse gap-2">
            {footerContent}
          </div>
        ) : showDefaultFooter && (
          <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse gap-2">
            <button
              type="button"
              onClick={onConfirm}
              disabled={isLoading || confirmDisabled}
              className={`inline-flex w-full justify-center rounded-md ${confirmButtonClass} px-3 py-2 text-sm font-semibold text-white shadow-sm sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed`}>
              {isLoading && (
                <Icon name="spinner" className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" />
              )}
              {confirmText ?? t('common.confirm')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto dark:bg-gray-700 dark:text-white dark:ring-gray-600 dark:hover:bg-gray-600">
              {cancelText ?? t('common.cancel')}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default FormModal;
