import React, { createContext, useContext, useState, useCallback, useMemo } from "react";

type HeaderButtonsContextType = {
  setHeaderButtons: (buttons: React.ReactNode) => void;
  headerButtons: React.ReactNode;
  setBackButtonTitle: (title: string | null) => void;
  backButtonTitle: string | null;
}

/**
 * Context for managing header buttons in the popup
 */
export const HeaderButtonsContext = createContext<HeaderButtonsContextType | undefined>(undefined);

/**
 * Provider component for HeaderButtonsContext
 */
export const HeaderButtonsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [headerButtons, setHeaderButtons] = useState<React.ReactNode>(null);
  const [backButtonTitle, setBackButtonTitle] = useState<string | null>(null);

  const handleSetHeaderButtons = useCallback((buttons: React.ReactNode) => {
    setHeaderButtons(buttons);
  }, []);

  const handleSetBackButtonTitle = useCallback((title: string | null) => {
    setBackButtonTitle(title);
  }, []);

  const value = useMemo(() => ({
    setHeaderButtons: handleSetHeaderButtons,
    headerButtons,
    setBackButtonTitle: handleSetBackButtonTitle,
    backButtonTitle
  }), [handleSetHeaderButtons, headerButtons, handleSetBackButtonTitle, backButtonTitle]);

  return (
    <HeaderButtonsContext.Provider value={value}>
      {children}
    </HeaderButtonsContext.Provider>
  );
};

/**
 * Hook to use the HeaderButtonsContext
 * @returns The HeaderButtonsContext value
 */
export const useHeaderButtons = (): {
  setHeaderButtons: (buttons: React.ReactNode) => void;
  headerButtons: React.ReactNode;
  setBackButtonTitle: (title: string | null) => void;
  backButtonTitle: string | null;
} => {
  const context = useContext(HeaderButtonsContext);
  if (context === undefined) {
    throw new Error("useHeaderButtons must be used within a HeaderButtonsProvider");
  }
  return context;
};