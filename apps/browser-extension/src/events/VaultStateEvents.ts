import { StorageKeys } from '@/utils/constants/storageKeys';

import { storage } from '#imports';

type Unsubscribe = () => void;
type Listener = () => void;

/**
 * Last unlock-key value this window wrote, used to ignore our own
 * storage events. Reset to null whenever the key is removed (any lock), so a
 * subsequent unlock in another window is detected as a foreign write.
 */
let lastOwnUnlockKey: string | null = null;

/**
 * Record an unlock-key value that THIS window is about to write. Must be
 * called BEFORE the actual write so the storage watcher can skip the
 * resulting self-event. The popup unlock/login flows call this via
 * `DbContext.storeUnlockKey`.
 */
export function markOwnUnlockKey(key: string): void {
  lastOwnUnlockKey = key;
}

/*
 * Reset `lastOwnUnlockKey` whenever the key is cleared in storage (i.e.
 * any window locks/logs out). Without this, A's stored "own" value would
 * mask a later unlock from B that happens to use the same key value.
 */
storage.watch<string | null>(StorageKeys.UNLOCK_KEY, (newValue) => {
  if (!newValue) {
    lastOwnUnlockKey = null;
  }
});

/**
 * Cross-window vault state events.
 */
export const vaultStateEvents = {
  /** Fires when the vault is locked in any window. */
  onVaultLocked(listener: Listener): Unsubscribe {
    return storage.watch<string | null>(StorageKeys.UNLOCK_KEY, (newValue) => {
      if (!newValue) {
        listener();
      }
    });
  },

  /**
   * Fires when ANOTHER window unlocks the vault (or completes login). The
   * active window's own write is filtered via `lastOwnUnlockKey`, which
   * is set synchronously before the write through `markOwnUnlockKey`.
   *
   * Unlocked means a foreign key AND a stored vault: a login stores its key
   * before the vault pull lands, so the key alone is not yet a vault to open.
   */
  onVaultUnlocked(listener: Listener): Unsubscribe {
    /**
     * Fire when both halves are present in storage.
     */
    const fireIfUnlocked = async (): Promise<void> => {
      const [key, vault] = await Promise.all([
        storage.getItem<string | null>(StorageKeys.UNLOCK_KEY),
        storage.getItem<string | null>(StorageKeys.ENCRYPTED_VAULT),
      ]);
      if (key && vault && key !== lastOwnUnlockKey) {
        listener();
      }
    };

    const unwatchKey = storage.watch<string | null>(StorageKeys.UNLOCK_KEY, (newValue) => {
      if (newValue && newValue !== lastOwnUnlockKey) {
        void fireIfUnlocked();
      }
    });
    const unwatchVault = storage.watch<string | null>(StorageKeys.ENCRYPTED_VAULT, (newValue) => {
      if (newValue) {
        void fireIfUnlocked();
      }
    });

    return (): void => {
      unwatchKey();
      unwatchVault();
    };
  },

  /** Fires when the user is logged out in any window. */
  onLoggedOut(listener: Listener): Unsubscribe {
    return storage.watch<string | null>(StorageKeys.ACCESS_TOKEN, (newValue) => {
      if (!newValue) {
        listener();
      }
    });
  },
};
