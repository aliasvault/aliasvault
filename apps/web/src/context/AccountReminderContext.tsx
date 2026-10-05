import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { useDb } from '@/context/DbContext';
import { useWebApi } from '@/context/WebApiContext';

import type { TwoFactorStatusResponse } from '@aliasvault/models/webapi';

/** Two-factor is only promoted once the vault has content, so a brand new account is not flagged right away to prevent fatigue in the out-of-the-box experience. */
const TWO_FACTOR_REMINDER_MIN_ITEMS = 10;

/**
 * The account reminders that currently apply, keyed by what they ask the user to do.
 */
export type AccountReminders = {
  /** Two-factor authentication is off on a vault that has content. */
  enableTwoFactor: boolean;
};

type AccountReminderContextType = {
  reminders: AccountReminders;
  hasReminders: boolean;
  refresh: () => Promise<void>;
};

const AccountReminderContext = createContext<AccountReminderContextType | undefined>(undefined);

/**
 * Account reminder provider.
 */
export const AccountReminderProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const webApi = useWebApi();
  const dbContext = useDb();
  const location = useLocation();
  const [twoFactorEnabled, setTwoFactorEnabled] = useState<boolean | null>(null);
  const [itemCount, setItemCount] = useState(0);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const status = await webApi.get<TwoFactorStatusResponse>('TwoFactorAuth/status');
      setTwoFactorEnabled(status.twoFactorEnabled);
    } catch {
      setTwoFactorEnabled(null);
    }
  }, [webApi]);

  useEffect(() => void refresh(), [refresh]);
  useEffect(() => {
    setItemCount(dbContext.sqliteClient?.items.getAllSummaries().length ?? 0);
  }, [dbContext.sqliteClient, location.pathname]);

  const value = useMemo((): AccountReminderContextType => {
    const reminders: AccountReminders = { enableTwoFactor: twoFactorEnabled === false && itemCount >= TWO_FACTOR_REMINDER_MIN_ITEMS };
    return { reminders, hasReminders: Object.values(reminders).some(Boolean), refresh };
  }, [twoFactorEnabled, itemCount, refresh]);

  return <AccountReminderContext.Provider value={value}>{children}</AccountReminderContext.Provider>;
};

/**
 * Access the account reminders.
 */
export const useAccountReminders = (): AccountReminderContextType => {
  const context = useContext(AccountReminderContext);
  if (!context) {
    throw new Error('useAccountReminders must be used within an AccountReminderProvider');
  }
  return context;
};
