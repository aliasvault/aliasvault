/**
 * Background message handler for Lace wallet detection and connection.
 *
 * Uses chrome.scripting.executeScript with world: "MAIN" to access
 * window.midnight.mnLace (DApp Connector API) in the active tab's page context.
 *
 * All handlers return result objects { success, data?, error? } instead of throwing,
 * because webext-bridge doesn't reliably propagate thrown errors from background to popup.
 */

import { browser } from '#imports';

/**
 * Wallet state returned after a successful connection.
 */
export interface WalletConnectionResult {
  address: string;
  coinPublicKey: string;
  encryptionPublicKey: string;
}

/**
 * Service URI config returned from the wallet.
 */
export interface WalletServiceUris {
  indexerUri: string;
  indexerWsUri: string;
  proverServerUri: string;
  substrateNodeUri: string;
}

/**
 * Standardized result wrapper for all wallet handlers.
 */
export interface WalletResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * URL prefixes that cannot be injected into via chrome.scripting.executeScript.
 */
const BLOCKED_URL_PREFIXES = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'brave://', 'opera://', 'vivaldi://'];

/**
 * Get the currently active tab, validating that the tab URL supports script injection.
 * Returns { tabId } on success or { error } on failure.
 */
async function getInjectableTab(): Promise<{ tabId: number } | { error: string }> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      return { error: 'No active tab found. Please open a web page and try again.' };
    }

    const url = tab.url ?? tab.pendingUrl ?? '';
    if (!url || !url.startsWith('http')) {
      return { error: 'Please navigate to a regular web page (e.g. google.com) and try again. Wallet cannot be accessed from browser internal pages.' };
    }

    return { tabId: tab.id };
  } catch {
    return { error: 'Failed to query active tab.' };
  }
}

/**
 * Detect whether the Lace wallet extension is available in the active tab.
 */
export async function handleDetectLaceWallet(): Promise<WalletResult<{ detected: boolean; apiVersion?: string }>> {
  const tab = await getInjectableTab();
  if ('error' in tab) {
    return { success: false, error: tab.error };
  }

  try {
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.tabId },
      world: 'MAIN',
      func: () => {
        const lace = (window as any).midnight?.mnLace;
        if (lace) {
          return { detected: true, apiVersion: lace.apiVersion as string };
        }
        return { detected: false };
      },
    });

    return { success: true, data: results[0]?.result ?? { detected: false } };
  } catch (err) {
    console.error('Failed to detect Lace wallet:', err);
    return { success: false, error: 'Failed to check for Lace wallet on this page.' };
  }
}

/**
 * Connect to the Lace wallet via the DApp Connector API.
 * Calls enable() which triggers the Lace authorization popup,
 * then retrieves wallet state (address, public keys).
 */
export async function handleConnectLaceWallet(): Promise<WalletResult<WalletConnectionResult>> {
  const tab = await getInjectableTab();
  if ('error' in tab) {
    return { success: false, error: tab.error };
  }

  try {
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.tabId },
      world: 'MAIN',
      func: async () => {
        const midnight = (window as any).midnight;
        if (!midnight) {
          return { __error: 'window.midnight not found. Is the Lace wallet extension installed and enabled?' };
        }

        const lace = midnight.mnLace;
        if (!lace) {
          return { __error: 'window.midnight.mnLace not found. Is the Midnight Lace wallet configured?' };
        }

        try {
          // Lace exposes connect(networkId) (newer API) or enable() (older API)
          // Supported networks: mainnet, preprod, preview, qanet, undeployed
          const networkId = 'undeployed';
          let api: any;
          if (typeof lace.connect === 'function') {
            api = await lace.connect(networkId);
          } else if (typeof lace.enable === 'function') {
            api = await lace.enable();
          } else {
            const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(lace) || {});
            return { __error: `No connect() or enable() method found. Available: [${proto.join(',')}]` };
          }

          // Lace v4+ API: getShieldedAddresses() and getUnshieldedAddress()
          const shieldedAddresses = typeof api.getShieldedAddresses === 'function'
            ? await api.getShieldedAddresses()
            : null;
          const unshieldedAddress = typeof api.getUnshieldedAddress === 'function'
            ? await api.getUnshieldedAddress()
            : null;

          const address = shieldedAddresses?.shieldedAddress ?? unshieldedAddress ?? null;
          if (!address) {
            return { __error: 'Could not retrieve wallet address.' };
          }

          return {
            address: String(address),
            coinPublicKey: unshieldedAddress ? String(unshieldedAddress) : '',
            encryptionPublicKey: shieldedAddresses?.shieldedAddress ? String(shieldedAddresses.shieldedAddress) : '',
          };
        } catch (e: any) {
          return { __error: e?.message ?? 'Wallet connection was rejected or failed.' };
        }
      },
    });

    const result = results[0]?.result;
    if (!result) {
      return { success: false, error: 'No response from Lace wallet. Please try again.' };
    }

    if (result.__error) {
      return { success: false, error: result.__error };
    }

    return { success: true, data: result as WalletConnectionResult };
  } catch (err: any) {
    console.error('Failed to connect Lace wallet:', err);
    return { success: false, error: err?.message ?? 'Failed to connect to Lace wallet.' };
  }
}

/**
 * Get service URI config from the connected Lace wallet.
 */
export async function handleGetWalletServiceUris(): Promise<WalletResult<WalletServiceUris>> {
  const tab = await getInjectableTab();
  if ('error' in tab) {
    return { success: false, error: tab.error };
  }

  try {
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.tabId },
      world: 'MAIN',
      func: async () => {
        const lace = (window as any).midnight?.mnLace;
        if (!lace) {
          return { __error: 'Midnight Lace wallet not found.' };
        }

        try {
          const uris = await lace.serviceUriConfig();
          return {
            indexerUri: uris.indexerUri as string,
            indexerWsUri: uris.indexerWsUri as string,
            proverServerUri: uris.proverServerUri as string,
            substrateNodeUri: uris.substrateNodeUri as string,
          };
        } catch (e: any) {
          return { __error: e?.message ?? 'Failed to get service URIs.' };
        }
      },
    });

    const result = results[0]?.result;
    if (!result) {
      return { success: false, error: 'No response from wallet.' };
    }

    if (result.__error) {
      return { success: false, error: result.__error };
    }

    return { success: true, data: result as WalletServiceUris };
  } catch (err: any) {
    console.error('Failed to get wallet service URIs:', err);
    return { success: false, error: err?.message ?? 'Failed to get wallet service URIs.' };
  }
}
