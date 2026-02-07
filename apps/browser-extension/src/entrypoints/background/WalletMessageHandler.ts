/**
 * Background message handler for Lace wallet detection and connection.
 *
 * Uses chrome.scripting.executeScript with world: "MAIN" to access
 * window.midnight.mnLace (DApp Connector API) in the active tab's page context.
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
 * Get the currently active tab ID.
 */
async function getActiveTabId(): Promise<number> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error('No active tab found. Please open a web page and try again.');
  }
  return tab.id;
}

/**
 * Detect whether the Lace wallet extension is available in the active tab.
 * Executes a script in the page's MAIN world to check window.midnight.mnLace.
 */
export async function handleDetectLaceWallet(): Promise<{ detected: boolean; apiVersion?: string }> {
  try {
    const tabId = await getActiveTabId();

    const results = await browser.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const lace = (window as any).midnight?.mnLace;
        if (lace) {
          return { detected: true, apiVersion: lace.apiVersion as string };
        }
        return { detected: false };
      },
    });

    return results[0]?.result ?? { detected: false };
  } catch (error) {
    console.error('Failed to detect Lace wallet:', error);
    return { detected: false };
  }
}

/**
 * Connect to the Lace wallet via the DApp Connector API.
 * Calls enable() which triggers the Lace authorization popup,
 * then retrieves wallet state (address, public keys).
 */
export async function handleConnectLaceWallet(): Promise<WalletConnectionResult> {
  const tabId = await getActiveTabId();

  const results = await browser.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async () => {
      const lace = (window as any).midnight?.mnLace;
      if (!lace) {
        throw new Error('Midnight Lace wallet not found. Is the extension installed and enabled?');
      }

      // enable() triggers the Lace authorization popup
      const api = await lace.enable();
      const state = await api.state();

      return {
        address: state.address as string,
        coinPublicKey: state.coinPublicKey as string,
        encryptionPublicKey: state.encryptionPublicKey as string,
      };
    },
  });

  const result = results[0]?.result;
  if (!result) {
    throw new Error('Failed to connect to Lace wallet. Please try again.');
  }

  return result as WalletConnectionResult;
}

/**
 * Get service URI config from the connected Lace wallet.
 */
export async function handleGetWalletServiceUris(): Promise<WalletServiceUris> {
  const tabId = await getActiveTabId();

  const results = await browser.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async () => {
      const lace = (window as any).midnight?.mnLace;
      if (!lace) {
        throw new Error('Midnight Lace wallet not found.');
      }

      const uris = await lace.serviceUriConfig();
      return {
        indexerUri: uris.indexerUri as string,
        indexerWsUri: uris.indexerWsUri as string,
        proverServerUri: uris.proverServerUri as string,
        substrateNodeUri: uris.substrateNodeUri as string,
      };
    },
  });

  const result = results[0]?.result;
  if (!result) {
    throw new Error('Failed to get wallet service URIs.');
  }

  return result as WalletServiceUris;
}
