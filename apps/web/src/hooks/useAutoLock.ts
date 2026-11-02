import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useDb } from '@/context/DbContext';
import { getLocalPreference, setLocalPreference } from '@/utils/LocalPreferences';
import { LocalPreferenceKeys } from '@/utils/StorageKeys';
import { vaultStore } from '@/vault/VaultStore';

/** Auto-lock timeout in seconds when the user has not chosen one: 1 hour. */
export const DEFAULT_AUTO_LOCK_TIMEOUT = 3600;

/** How often the idle time is checked. */
const CHECK_INTERVAL_MS = 5000;

/** User input that counts as activity. */
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

/**
 * Get the auto-lock timeout of this browser in seconds, 0 means never.
 */
export function getAutoLockTimeout(): number {
  const value = Number.parseInt(getLocalPreference(LocalPreferenceKeys.AUTO_LOCK_TIMEOUT) ?? '', 10);
  return Number.isNaN(value) || value < 0 ? DEFAULT_AUTO_LOCK_TIMEOUT : value;
}

/**
 * Set the auto-lock timeout of this browser in seconds, 0 means never.
 */
export function setAutoLockTimeout(timeout: number): void {
  setLocalPreference(LocalPreferenceKeys.AUTO_LOCK_TIMEOUT, String(timeout));
}

/**
 * Lock the vault after the auto-lock timeout passes without user input in this tab.
 * @param enabled - whether the vault is open
 */
export function useAutoLock(enabled: boolean): void {
  const navigate = useNavigate();
  const location = useLocation();
  const { clearDatabase } = useDb();
  const currentUrl = useRef('');
  currentUrl.current = location.pathname + location.search;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let lastActivity = Date.now();
    let locking = false;

    /**
     * Record user input.
     */
    const onActivity = (): void => {
      lastActivity = Date.now();
    };

    /**
     * Lock the vault when the timeout has passed; the unlock page returns to the current page.
     */
    const check = async (): Promise<void> => {
      const timeout = getAutoLockTimeout();
      if (locking || timeout === 0 || Date.now() - lastActivity < timeout * 1000) {
        return;
      }
      locking = true;
      setLocalPreference(LocalPreferenceKeys.RETURN_URL, currentUrl.current);
      await vaultStore.lockVault();
      clearDatabase();
      navigate('/unlock/true', { replace: true });
    };

    /**
     * Run a check from an event or timer.
     */
    const runCheck = (): void => void check();

    /**
     * Check when the tab is shown again after being hidden, frozen or asleep.
     */
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        runCheck();
      }
    };

    ACTIVITY_EVENTS.forEach(event => window.addEventListener(event, onActivity, { capture: true, passive: true }));
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', runCheck);
    window.addEventListener('focus', runCheck);
    const interval = setInterval(runCheck, CHECK_INTERVAL_MS);

    return (): void => {
      ACTIVITY_EVENTS.forEach(event => window.removeEventListener(event, onActivity, { capture: true }));
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', runCheck);
      window.removeEventListener('focus', runCheck);
      clearInterval(interval);
    };
  }, [enabled, clearDatabase, navigate]);
}
