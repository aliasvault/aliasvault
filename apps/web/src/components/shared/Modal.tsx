import React from 'react';

type ModalProps = {
  children: React.ReactNode;
  id?: string;
  panelRef?: React.Ref<HTMLDivElement>;
  /** Size and layout of the panel, e.g. `w-full max-w-2xl flex flex-col`. */
  panelClassName?: string;
  position?: 'center' | 'top';
  zIndexClass?: string;
  tabIndex?: number;
  onBackdropClick?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
};

/**
 * Backdrop and panel surface shared by every modal.
 */
const Modal: React.FC<ModalProps> = ({ children, id, panelRef, panelClassName = '', position = 'center', zIndexClass = 'z-50', tabIndex, onBackdropClick, onKeyDown }) => {
  /**
   * Only a click that lands on the backdrop counts, not one that bubbles up from the panel.
   */
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) {
      onBackdropClick?.();
    }
  };

  return (
    <div className={`fixed inset-0 ${zIndexClass}`} onKeyDown={onKeyDown}>
      <div className="fixed inset-0 bg-gray-600/50 backdrop-blur-sm dark:bg-black/70" />
      <div className="fixed inset-0 overflow-y-auto">
        <div className={`flex min-h-full justify-center p-4 ${position === 'top' ? 'items-start pt-40 pb-8' : 'items-center'}`} onClick={handleBackdropClick}>
          <div ref={panelRef} id={id} tabIndex={tabIndex} className={`relative rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-800 dark:shadow-2xl ${panelClassName}`}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Modal;
