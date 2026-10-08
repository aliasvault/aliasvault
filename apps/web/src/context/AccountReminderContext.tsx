import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { useDb } from '@/context/DbContext';
import { useWebApi } from '@/context/WebApiContext';
import { useVaultMutate } from '@/hooks/useVaultMutate';

import type { TwoFactorStatusResponse } from '@aliasvault/models/webapi';

/** Two-factor is only promoted once the vault has content, so a brand new account is not flagged right away to prevent fatigue in the out-of-the-box experience. */
const TWO_FACTOR_REMINDER_MIN_ITEMS = 10;

/** Vault setting that records the user chose not to be reminded about two-factor authentication. */
const TWO_FACTOR_REMINDER_DISMISSED_KEY = 'TwoFactorReminderDismissed';

/**
 * The account reminders that currently apply, keyed by what they ask the user to do.
 */
export type AccountReminders = {
  /** Two-factor authentication is off on a vault that has content, and the user has not dismissed the reminder. */
  enableTwoFactor: boolean;
};

type AccountReminderContextType = {
  reminders: AccountReminders;
  hasReminders: boolean;
  /** Whether the user dismissed the two-factor reminder; the reminder and its warning then stay hidden. */
  twoFactorReminderDismissed: boolean;
  refresh: () => Promise<void>;
  dismissTwoFactorReminder: () => Promise<void>;
};

const AccountReminderContext = createContext<AccountReminderContextType | undefined>(undefined);

/**
 * Account reminder provider.
 */
export const AccountReminderProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const webApi = useWebApi();
  const dbContext = useDb();
  const location = useLocation();
  const { executeVaultMutationInBackground } = useVaultMutate();
  const [twoFactorEnabled, setTwoFactorEnabled] = useState<boolean | null>(null);
  const [itemCount, setItemCount] = useState(0);
  const [twoFactorReminderDismissed, setTwoFactorReminderDismissed] = useState(false);

  /**
   * Re-read the vault-side inputs: the item count and the dismissed flag.
   */
  const readVaultState = useCallback((): void => {
    const client = dbContext.sqliteClient;
    setItemCount(client?.items.getAllSummaries().length ?? 0);
    setTwoFactorReminderDismissed((client?.settings.getSetting(TWO_FACTOR_REMINDER_DISMISSED_KEY, 'False') ?? 'False').toLowerCase() === 'true');
  }, [dbContext.sqliteClient]);

  const refresh = useCallback(async (): Promise<void> => {
    readVaultState();
    try {
      const status = await webApi.get<TwoFactorStatusResponse>('TwoFactorAuth/status');
      setTwoFactorEnabled(status.twoFactorEnabled);
    } catch {
      setTwoFactorEnabled(null);
    }
  }, [webApi, readVaultState]);

  useEffect(() => void refresh(), [refresh]);
  useEffect(readVaultState, [readVaultState, location.pathname]);

  /**
   * Persist dismiss state in the vault so it's not prompted again.
   */
  const dismissTwoFactorReminder = useCallback(async (): Promise<void> => {
    setTwoFactorReminderDismissed(true);
    await executeVaultMutationInBackground(async () => {
      dbContext.sqliteClient?.settings.updateSetting(TWO_FACTOR_REMINDER_DISMISSED_KEY, 'True');
    });
  }, [dbContext.sqliteClient, executeVaultMutationInBackground]);

  const value = useMemo((): AccountReminderContextType => {
    const reminders: AccountReminders = { enableTwoFactor: twoFactorEnabled === false && !twoFactorReminderDismissed && itemCount >= TWO_FACTOR_REMINDER_MIN_ITEMS };
    return { reminders, hasReminders: Object.values(reminders).some(Boolean), twoFactorReminderDismissed, refresh, dismissTwoFactorReminder };
  }, [twoFactorEnabled, twoFactorReminderDismissed, itemCount, refresh, dismissTwoFactorReminder]);

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
