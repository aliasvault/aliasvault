import { storage } from '#imports';

type Unsubscribe = () => void;
type Listener = () => void;

const ENCRYPTION_KEY_STORAGE_KEY = 'session:encryptionKey';
const ACCESS_TOKEN_STORAGE_KEY = 'local:accessToken';

/**
 * Cross-window vault state events. Backed by extension storage because the popup
 * and expanded popout are separate JS realms — an in-process emitter can't bridge them.
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

  /** Fires when the user is logged out in any window. */
  onLoggedOut(listener: Listener): Unsubscribe {
    return storage.watch<string | null>(ACCESS_TOKEN_STORAGE_KEY, (newValue) => {
      if (!newValue) {
        listener();
      }
    });
  },
};
