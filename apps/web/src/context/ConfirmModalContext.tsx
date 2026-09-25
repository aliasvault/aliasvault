import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import ConfirmModal from '@/components/shared/ConfirmModal';

/**
 * What a confirmation asks.
 */
type ConfirmRequest = {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
};

type ConfirmModalContextType = {
  showConfirmation: (title: string, message: string, confirmText: string, cancelText: string) => Promise<boolean>;
}

const ConfirmModalContext = createContext<ConfirmModalContextType | undefined>(undefined);

/**
 * Global confirm dialog.
 */
export const ConfirmModalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);

  /**
   * Show the confirm dialog and resolve with the user's answer.
   */
  const showConfirmation = useCallback((title: string, message: string, confirmText: string, cancelText: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setRequest({ title, message, confirmText, cancelText });
    });
  }, []);

  /**
   * Close the dialog with the user's answer.
   */
  const close = useCallback((confirmed: boolean): void => {
    setRequest(null);
    resolver.current?.(confirmed);
    resolver.current = null;
  }, []);

  const value = useMemo(() => ({ showConfirmation }), [showConfirmation]);

  return (
    <ConfirmModalContext.Provider value={value}>
      {children}
      {request && (
        <ConfirmModal title={request.title} message={request.message} confirmText={request.confirmText} cancelText={request.cancelText} onClose={close} />
      )}
    </ConfirmModalContext.Provider>
  );
};

/**
 * Hook to use the confirm dialog.
 */
export const useConfirmModal = (): ConfirmModalContextType => {
  const context = useContext(ConfirmModalContext);
  if (context === undefined) {
    throw new Error('useConfirmModal must be used within a ConfirmModalProvider');
  }
  return context;
};
