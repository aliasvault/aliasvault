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
import { CURRENT_NETWORK } from '@/entrypoints/popup/config/networkConfig';

/**
 * Network ID passed to Lace wallet connect().
 * Sourced from shared networkConfig — injected scripts receive this as an argument
 * since they run in the page's MAIN world and cannot import extension modules.
 */
const WALLET_NETWORK_ID: string = CURRENT_NETWORK;

/**
 * Wallet state returned after a successful connection.
 */
export interface WalletConnectionResult {
  address: string;
  coinPublicKey: string;
  shieldedAddress: string;
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
        const midnight = (window as any).midnight;
        if (!midnight) return { detected: false };
        // Lace v4+ registers under a UUID key instead of 'mnLace'
        const lace = midnight.mnLace
          ?? Object.keys(midnight).map((k) => midnight[k]).find((w) => w?.name === 'lace')
          ?? Object.values(midnight)[0];
        if (lace?.apiVersion) {
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
      args: [WALLET_NETWORK_ID],
      func: async (networkId: string) => {
        const midnight = (window as any).midnight;
        if (!midnight) {
          return { __error: 'window.midnight not found. Is the Lace wallet extension installed and enabled?' };
        }

        // Lace v4+ registers under a UUID key instead of 'mnLace'
        const lace = midnight.mnLace
          ?? Object.keys(midnight).map((k: string) => midnight[k]).find((w: any) => w?.name === 'lace')
          ?? Object.values(midnight)[0] as any;
        if (!lace) {
          return { __error: 'No Midnight wallet found in window.midnight.' };
        }

        try {
          if (typeof lace.connect !== 'function') {
            return { __error: `Wallet "${lace.name}" has no connect() method.` };
          }
          const api: any = await lace.connect(networkId);

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
            shieldedAddress: shieldedAddresses?.shieldedAddress ? String(shieldedAddresses.shieldedAddress) : '',
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
 * Result from signing a challenge message.
 */
export interface SignChallengeResult {
  signature: string;
  publicKey: string;
  challenge: string;
  /** 'signature' if signData succeeded, 'connection-proof' if fallback was used. */
  authMethod: 'signature' | 'connection-proof';
}

/**
 * Sign a challenge message with the connected Lace wallet.
 * The challenge is passed as data.challenge from the popup.
 */
export async function handleSignChallenge(data: { challenge: string }): Promise<WalletResult<SignChallengeResult>> {
  const tab = await getInjectableTab();
  if ('error' in tab) {
    return { success: false, error: tab.error };
  }

  const challenge = data?.challenge;
  if (!challenge) {
    return { success: false, error: 'No challenge provided.' };
  }

  try {
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.tabId },
      world: 'MAIN',
      args: [challenge, WALLET_NETWORK_ID],
      func: async (challengeStr: string, networkId: string) => {
        const midnight = (window as any).midnight;
        if (!midnight) {
          return { __error: 'Midnight Lace wallet not found.' };
        }

        try {
          // Lace v4+ registers under a UUID key instead of 'mnLace'
          const lace = midnight.mnLace
            ?? Object.keys(midnight).map((k: string) => midnight[k]).find((w: any) => w?.name === 'lace')
            ?? Object.values(midnight)[0] as any;
          if (!lace?.connect) {
            return { __error: 'No Midnight wallet with connect() found.' };
          }
          const api = await lace.connect(networkId);

          // Get wallet address as identity proof
          const shieldedAddresses = typeof api.getShieldedAddresses === 'function'
            ? await api.getShieldedAddresses()
            : null;
          const walletAddress = shieldedAddresses?.shieldedAddress ?? '';

          let signature = '';
          let publicKey = walletAddress;
          let authMethod: 'signature' | 'connection-proof' = 'connection-proof';

          // Try signData if available (Lace v4+ feature)
          if (typeof api.signData === 'function') {
            try {
              const encoder = new TextEncoder();
              const payload = encoder.encode(challengeStr);
              const signed = await api.signData(payload);

              // signData may return { signature, key } or just a signature string
              const sig = typeof signed === 'object' ? String(signed.signature ?? signed) : String(signed);
              const key = typeof signed === 'object' ? String(signed.key ?? signed.publicKey ?? walletAddress) : walletAddress;

              // Validate that signData returned a non-empty signature
              if (sig && sig !== 'undefined' && sig !== '[object Object]') {
                signature = sig;
                publicKey = key;
                authMethod = 'signature';
              } else {
                // signData returned empty/invalid — fall back
                signature = `connection-proof:${walletAddress}:${challengeStr}`;
              }
            } catch (signErr: any) {
              // signData not implemented or rejected in current Lace version
              // Fall back to connection-based auth: the Lace connect() popup itself
              // proves the user controls this wallet (they authorized the DApp).
              // NOTE: This is weaker than cryptographic signing — it only proves the
              // user approved the connection, not that they signed this specific challenge.
              signature = `connection-proof:${walletAddress}:${challengeStr}`;
            }
          } else {
            // signData not available — use connection-based proof
            signature = `connection-proof:${walletAddress}:${challengeStr}`;
          }

          return {
            signature: String(signature),
            publicKey: String(publicKey),
            challenge: challengeStr,
            authMethod,
          };
        } catch (e: any) {
          return { __error: e?.message ?? 'Signing was rejected or failed.' };
        }
      },
    });

    const result = results[0]?.result;
    if (!result) {
      return { success: false, error: 'No response from wallet during signing.' };
    }

    if (result.__error) {
      return { success: false, error: result.__error };
    }

    return { success: true, data: result as SignChallengeResult };
  } catch (err: any) {
    console.error('Failed to sign challenge:', err);
    return { success: false, error: err?.message ?? 'Failed to sign challenge.' };
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
        const midnight = (window as any).midnight;
        if (!midnight) {
          return { __error: 'Midnight Lace wallet not found.' };
        }
        // Lace v4+ registers under a UUID key instead of 'mnLace'
        const lace = midnight.mnLace
          ?? Object.keys(midnight).map((k: string) => midnight[k]).find((w: any) => w?.name === 'lace')
          ?? Object.values(midnight)[0] as any;
        if (!lace) {
          return { __error: 'No Midnight wallet found.' };
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
