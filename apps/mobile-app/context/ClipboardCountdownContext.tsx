import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

export type ActiveClipboardField = {
  fieldId: string;
  timeoutSeconds: number;
  /** Monotonic counter so re-copying the same field still triggers a state change. */
  trigger: number;
} | null;

type ClipboardCountdownContextType = {
  activeField: ActiveClipboardField;
  startCountdown: (fieldId: string, timeoutSeconds: number) => void;
  clearCountdown: () => void;
}

const ClipboardCountdownContext = createContext<ClipboardCountdownContextType | undefined>(undefined);

/**
 * Clipboard countdown context provider.
 */
export const ClipboardCountdownProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeField, setActiveField] = useState<ActiveClipboardField>(null);

  const startCountdown = useCallback((fieldId: string, timeoutSeconds: number) => {
    setActiveField((prev) => ({
      fieldId,
      timeoutSeconds,
      trigger: (prev?.trigger ?? 0) + 1,
    }));
  }, []);

  const clearCountdown = useCallback(() => {
    setActiveField(null);
  }, []);

  const value = useMemo(
    () => ({ activeField, startCountdown, clearCountdown }),
    [activeField, startCountdown, clearCountdown],
  );

  return (
    <ClipboardCountdownContext.Provider value={value}>
      {children}
    </ClipboardCountdownContext.Provider>
  );
};

/**
 * Clipboard countdown context hook.
 */
export const useClipboardCountdown = (): ClipboardCountdownContextType => {
  const context = useContext(ClipboardCountdownContext);
  if (!context) {
    throw new Error('useClipboardCountdown must be used within ClipboardCountdownProvider');
  }
  return context;
};
