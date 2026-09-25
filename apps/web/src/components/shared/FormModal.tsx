import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

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
  isOpen, title = '', icon, iconBackgroundClass = 'bg-orange-100 dark:bg-orange-900/30', children, footerContent, showDefaultFooter = true,
  confirmText, cancelText, confirmDisabled = false, confirmButtonClass = 'bg-primary-600 hover:bg-primary-700', isLoading = false, maxWidth = 'lg',
  closeOnOverlayClick = true, closeOnEscape = true, submitOnEnter = true, onClose, onConfirm,
}) => {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
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
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity dark:bg-gray-900 dark:bg-opacity-75" onClick={() => closeOnOverlayClick && onClose()}></div>

        <div ref={panelRef} onKeyDown={handleKeyDown} tabIndex={0} className={`relative transform overflow-hidden rounded-lg bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full ${getMaxWidthClass(maxWidth)} dark:bg-gray-800`}>
          <div className="bg-white px-4 pb-4 pt-5 sm:p-6 dark:bg-gray-800">
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
          </div>

          {footerContent ? (
            <div className="bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6 gap-2 dark:bg-gray-800/50">
              {footerContent}
            </div>
          ) : showDefaultFooter && (
            <div className="bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6 gap-2 dark:bg-gray-800/50">
              <button
                type="button"
                onClick={onConfirm}
                disabled={isLoading || confirmDisabled}
                className={`inline-flex w-full justify-center rounded-md ${confirmButtonClass} px-3 py-2 text-sm font-semibold text-white shadow-sm sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed`}>
                {isLoading && (
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                )}
                {confirmText ?? t('sharedResources.Confirm')}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto dark:bg-gray-700 dark:text-white dark:ring-gray-600 dark:hover:bg-gray-600">
                {cancelText ?? t('sharedResources.Cancel')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FormModal;
