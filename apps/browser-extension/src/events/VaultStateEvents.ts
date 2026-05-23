import { storage } from '#imports';

type Unsubscribe = () => void;
type Listener = () => void;

const ENCRYPTION_KEY_STORAGE_KEY = 'session:encryptionKey';
const ACCESS_TOKEN_STORAGE_KEY = 'local:accessToken';

/**
 * Last encryption-key value this window wrote, used to ignore our own
 * storage events. Reset to null whenever the key is removed (any lock), so a
 * subsequent unlock in another window is detected as a foreign write.
 */
let lastOwnEncryptionKey: string | null = null;

/**
 * Record an encryption-key value that THIS window is about to write. Must be
 * called BEFORE the actual write so the storage watcher can skip the
 * resulting self-event. The popup unlock/login flows call this via
 * `DbContext.storeEncryptionKey`.
 */
export function markOwnEncryptionKey(key: string): void {
  lastOwnEncryptionKey = key;
}

/*
 * Reset `lastOwnEncryptionKey` whenever the key is cleared in storage (i.e.
 * any window locks/logs out). Without this, A's stored "own" value would
 * mask a later unlock from B that happens to use the same key value.
 */
storage.watch<string | null>(ENCRYPTION_KEY_STORAGE_KEY, (newValue) => {
  if (!newValue) {
    lastOwnEncryptionKey = null;
  }
});

/**
 * Cross-window vault state events.
 */
export const vaultStateEvents = {
  /** Fires when the vault is locked in any window. */
  onVaultLocked(listener: Listener): Unsubscribe {
    return storage.watch<string | null>(ENCRYPTION_KEY_STORAGE_KEY, (newValue) => {
      if (!newValue) {
        listener();
      }
    });
  },

  /**
   * Fires when ANOTHER window unlocks the vault (or completes login). The
   * active window's own write is filtered via `lastOwnEncryptionKey`, which
   * is set synchronously before the write through `markOwnEncryptionKey`.
   */
  onVaultUnlocked(listener: Listener): Unsubscribe {
    return storage.watch<string | null>(ENCRYPTION_KEY_STORAGE_KEY, (newValue) => {
      if (newValue && newValue !== lastOwnEncryptionKey) {
        listener();
      }
    });
  },

  /** Fires when the user is logged out in any window. */
  onLoggedOut(listener: Listener): Unsubscribe {
    return storage.watch<string | null>(ACCESS_TOKEN_STORAGE_KEY, (newValue) => {
      if (!newValue) {
        listener();
      }
    });
  },
};
