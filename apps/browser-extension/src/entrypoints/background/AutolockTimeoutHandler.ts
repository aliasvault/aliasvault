import { handleLockVault } from '@/entrypoints/background/VaultMessageHandler';

import { LocalPreferencesService } from '@/utils/LocalPreferencesService';

import type { Browser } from 'wxt/browser';

import { browser, storage } from '#imports';

const AUTO_LOCK_ALARM_NAME = 'vault-auto-lock';

/*
 * Threshold in seconds below which we use setTimeout instead of alarms.
 * Alarms have a minimum delay of 30 seconds in production (packed) extensions.
 * For short timeouts, setTimeout is more accurate and the service worker
 * won't terminate before the timer fires.
 */
const SHORT_TIMEOUT_THRESHOLD = 30;

// Timer handle for short timeouts using setTimeout
let shortTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Lock the vault due to inactivity timeout.
 */
async function lockVaultDueToInactivity(): Promise<void> {
  // Check if vault is still unlocked before locking
  const encryptionKey = await storage.getItem('session:encryptionKey') as string | null;
  if (!encryptionKey) {
    // Vault is already locked
    return;
  }

  try {
    handleLockVault();
    console.info('[AUTO_LOCK] Vault locked due to inactivity');
  } catch (error) {
    console.error('[AUTO_LOCK] Error locking vault:', error);
  }
}

/**
 * Clear the short timeout timer if it exists.
 */
function clearShortTimeoutTimer(): void {
  if (shortTimeoutTimer) {
    clearTimeout(shortTimeoutTimer);
    shortTimeoutTimer = null;
  }
}

/**
 * Set the auto-lock timer using the appropriate method based on timeout duration.
 * Uses setTimeout for short timeouts (< 30s) and alarms for longer ones.
 */
async function setAutoLockTimer(timeoutSeconds: number): Promise<void> {
  // Clear any existing timers
  clearShortTimeoutTimer();
  await browser.alarms.clear(AUTO_LOCK_ALARM_NAME);

  if (timeoutSeconds < SHORT_TIMEOUT_THRESHOLD) {
    /*
     * Use setTimeout for short timeouts.
     * Service worker won't terminate before the timer fires.
     */
    shortTimeoutTimer = setTimeout(() => {
      shortTimeoutTimer = null;
      lockVaultDueToInactivity();
    }, timeoutSeconds * 1000);
  } else {
    /*
     * Use alarms for longer timeouts.
     * Alarms persist across service worker restarts.
     */
    const delayInMinutes = timeoutSeconds / 60;
    await browser.alarms.create(AUTO_LOCK_ALARM_NAME, {
      delayInMinutes: delayInMinutes
    });
  }
}

/**
 * Initialize the auto-lock alarm system.
 * This should be called when the background script starts.
 * It checks if the vault is unlocked and if so, ensures a timer is set.
 */
export async function initializeAutoLockAlarm(): Promise<void> {
  // Check if vault is unlocked
  const encryptionKey = await storage.getItem('session:encryptionKey') as string | null;
  if (!encryptionKey) {
    // Vault is locked, clear any existing alarm
    clearShortTimeoutTimer();
    await browser.alarms.clear(AUTO_LOCK_ALARM_NAME);
    return;
  }

  // Get timeout setting
  const timeout = await LocalPreferencesService.getAutoLockTimeout();
  if (timeout === 0) {
    // Auto-lock disabled, clear any existing alarm
    clearShortTimeoutTimer();
    await browser.alarms.clear(AUTO_LOCK_ALARM_NAME);
    return;
  }

  /*
   * For short timeouts, we can't restore the exact remaining time after
   * service worker restart, so we just set a new timer with the full duration.
   * For alarms, check if one already exists to avoid resetting the countdown.
   */
  if (timeout < SHORT_TIMEOUT_THRESHOLD) {
    // Short timeout - set a new setTimeout (can't persist across restarts anyway)
    if (!shortTimeoutTimer) {
      await setAutoLockTimer(timeout);
    }
  } else {
    // Long timeout - only create alarm if one doesn't exist
    const existingAlarm = await browser.alarms.get(AUTO_LOCK_ALARM_NAME);
    if (!existingAlarm) {
      await setAutoLockTimer(timeout);
    }
  }
}

/**
 * Handle the auto-lock alarm firing.
 * This is called by the alarm listener in background.ts.
 */
export async function handleAutoLockAlarm(alarm: Browser.alarms.Alarm): Promise<void> {
  if (alarm.name !== AUTO_LOCK_ALARM_NAME) {
    return;
  }

  await lockVaultDueToInactivity();
}

/**
 * Reset the auto-lock timer.
 * This clears any existing timer and creates a new one with the full timeout period.
 */
export async function handleResetAutoLockTimer(): Promise<void> {
  // Get timeout setting
  const timeout = await LocalPreferencesService.getAutoLockTimeout();

  // Don't set timer if timeout is 0 (disabled)
  if (timeout === 0) {
    clearShortTimeoutTimer();
    await browser.alarms.clear(AUTO_LOCK_ALARM_NAME);
    return;
  }

  // Check if vault is unlocked before setting timer
  const encryptionKey = await storage.getItem('session:encryptionKey') as string | null;
  if (!encryptionKey) {
    // Vault is already locked, don't start timer
    clearShortTimeoutTimer();
    await browser.alarms.clear(AUTO_LOCK_ALARM_NAME);
    return;
  }

  await setAutoLockTimer(timeout);
}

/**
 * Handle popup heartbeat - extend auto-lock timer.
 * This resets the timer to prevent locking while popup is active.
 */
export async function handlePopupHeartbeat(): Promise<void> {
  // Get timeout setting
  const timeout = await LocalPreferencesService.getAutoLockTimeout();

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

  await setAutoLockTimer(timeout);
}

/**
 * Set the auto-lock timeout setting.
 * Updates the stored preference and resets the timer with the new value.
 */
export async function handleSetAutoLockTimeout(timeout: number): Promise<boolean> {
  await LocalPreferencesService.setAutoLockTimeout(timeout);

  // Clear existing timers
  clearShortTimeoutTimer();
  await browser.alarms.clear(AUTO_LOCK_ALARM_NAME);

  // If timeout is 0 (disabled), we're done
  if (timeout === 0) {
    return true;
  }

  // Check if vault is unlocked before setting new timer
  const encryptionKey = await storage.getItem('session:encryptionKey') as string | null;
  if (!encryptionKey) {
    // Vault is locked, don't start timer
    return true;
  }

  await setAutoLockTimer(timeout);
  return true;
}

/**
 * Clear the auto-lock alarm and any short timeout timer.
 * This should be called when the vault is locked.
 */
export async function clearAutoLockAlarm(): Promise<void> {
  clearShortTimeoutTimer();
  await browser.alarms.clear(AUTO_LOCK_ALARM_NAME);
}
