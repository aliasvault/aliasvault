import { storage } from 'wxt/utils/storage';

import { handleClearVault } from '@/entrypoints/background/VaultMessageHandler';

import { AUTO_LOCK_TIMEOUT_KEY } from '@/utils/Constants';

let autoLockTimer: NodeJS.Timeout | null = null;

/**
 * Reset the auto-lock timer.
 */
export function handleResetAutoLockTimer(): void {
  resetAutoLockTimer();
}

/**
 * Handle popup heartbeat - extend auto-lock timer.
 */
export function handlePopupHeartbeat(): void {
  extendAutoLockTimer();
}

/**
 * Set the auto-lock timeout setting.
 */
export async function handleSetAutoLockTimeout(timeout: number): Promise<boolean> {
  await storage.setItem(AUTO_LOCK_TIMEOUT_KEY, timeout);
  resetAutoLockTimer();
  return true;
}

/**
 * Reset the auto-lock timer based on current settings.
 */
async function resetAutoLockTimer(): Promise<void> {
  // Clear existing timer
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }

  // Get timeout setting
  const timeout = await storage.getItem(AUTO_LOCK_TIMEOUT_KEY) as number ?? 0;

  // Don't set timer if timeout is 0 (disabled) or if vault is already locked
  if (timeout === 0) {
    return;
  }

  // Check if vault is unlocked before setting timer
  const encryptionKey = await storage.getItem('session:encryptionKey') as string | null;

  if (!encryptionKey) {
    // Vault is already locked, don't start timer
    return;
  }

  // Set new timer
  autoLockTimer = setTimeout(async () => {
    try {
      // Lock the vault using the existing handler
      handleClearVault();

      console.info('[AUTO_LOCK] Vault locked due to inactivity');
      autoLockTimer = null;
    } catch (error) {
      console.error('[AUTO_LOCK] Error locking vault:', error);
    }
  }, timeout * 1000);
}

/**
 * Extend the auto-lock timer by the full timeout period.
 * This is called by popup heartbeats to prevent locking while popup is active.
 */
async function extendAutoLockTimer(): Promise<void> {
  // Get timeout setting
  const timeout = await storage.getItem(AUTO_LOCK_TIMEOUT_KEY) as number ?? 0;

  // Don't extend timer if timeout is 0 (disabled)
  if (timeout === 0) {
    return;
  }

  // Check if vault is unlocked
  const encryptionKey = await storage.getItem('session:encryptionKey') as string | null;

  if (!encryptionKey) {
    // Vault is already locked, don't extend timer
    return;
  }

  // Clear existing timer and start a new one
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }

  // Set new timer
  autoLockTimer = setTimeout(async () => {
    try {
      // Lock the vault using the existing handler
      handleClearVault();

      console.info('[AUTO_LOCK] Vault locked due to inactivity');
      autoLockTimer = null;
    } catch (error) {
      console.error('[AUTO_LOCK] Error locking vault:', error);
    }
  }, timeout * 1000);
}
