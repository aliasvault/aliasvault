import React, { useEffect } from 'react';

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
 * Number of modals open; the page stays locked until the last one closes.
 */
let openModals = 0;

/**
 * Stop the page behind the modals from scrolling, keeping the width the scrollbar took so the layout does not shift.
 */
function lockPageScroll(): () => void {
  const root = document.documentElement;
  if (openModals++ === 0) {
    root.style.paddingRight = `${window.innerWidth - root.clientWidth}px`;
    root.style.overflow = 'hidden';
  }
  return (): void => {
    if (--openModals === 0) {
      root.style.paddingRight = '';
      root.style.overflow = '';
    }
  };
}

/**
 * Backdrop and panel surface shared by every modal.
 */
const Modal: React.FC<ModalProps> = ({ children, id, panelRef, panelClassName = '', position = 'center', zIndexClass = 'z-50', tabIndex, onBackdropClick, onKeyDown }) => {
  useEffect(() => lockPageScroll(), []);

  /**
   * Only a click that lands on the backdrop counts, not one that bubbles up from the panel.
   */
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) {
      onBackdropClick?.();
    }
  };

  return (
    <div className={`fixed inset-0 cursor-default ${zIndexClass}`} onKeyDown={onKeyDown}>
      <div className="fixed inset-0 bg-gray-600/50 backdrop-blur-sm dark:bg-black/70" />
      <div className="fixed inset-0 overflow-y-auto overscroll-contain">
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
