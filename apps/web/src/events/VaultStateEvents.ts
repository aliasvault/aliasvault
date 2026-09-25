import { getPlatform } from '@aliasvault/client/platform';

import { StorageKeys } from '@/utils/StorageKeys';

type Unsubscribe = () => void;
type Listener = () => void;

/**
 * Vault state events. The access token is stored for every tab, so a logout reaches all open tabs.
 */
export const vaultStateEvents = {
  /** Fires when the user is logged out in any tab. */
  onLoggedOut(listener: Listener): Unsubscribe {
    return getPlatform().storage.watch<string | null>(StorageKeys.ACCESS_TOKEN, (newValue) => {
      if (!newValue) {
        listener();
      }
    });
  },
};
