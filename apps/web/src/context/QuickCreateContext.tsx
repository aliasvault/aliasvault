import { ItemTypes, type ItemType } from '@aliasvault/models/vault';
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

import QuickCreateDialog from '@/components/items/QuickCreateDialog';

type QuickCreateContextType = {
  openQuickCreate: (type?: ItemType) => void;
};

const QuickCreateContext = createContext<QuickCreateContextType | undefined>(undefined);

/**
 * Item quick create dialog.
 */
export const QuickCreateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [openType, setOpenType] = useState<ItemType | null>(null);

  const openQuickCreate = useCallback((type?: ItemType): void => setOpenType(type ?? ItemTypes.Login), []);
  const closeQuickCreate = useCallback((): void => setOpenType(null), []);

  const value = useMemo(() => ({ openQuickCreate }), [openQuickCreate]);

  return (
    <QuickCreateContext.Provider value={value}>
      {children}
      {openType !== null && <QuickCreateDialog initialType={openType} onClose={closeQuickCreate} />}
    </QuickCreateContext.Provider>
  );
};

/**
 * Access the quick create dialog.
 */
export const useQuickCreate = (): QuickCreateContextType => {
  const context = useContext(QuickCreateContext);
  if (!context) {
    throw new Error('useQuickCreate must be used within a QuickCreateProvider');
  }
  return context;
};
