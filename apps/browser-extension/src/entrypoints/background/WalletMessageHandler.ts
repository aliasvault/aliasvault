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
import { setWalletState } from '@/services/providers/WalletState';

/**
 * Network ID passed to Lace wallet connect().
 * Sourced from shared networkConfig — injected scripts receive this as an argument
 * since they run in the page's MAIN world and cannot import extension modules.
 */
const WALLET_NETWORK_ID: string = CURRENT_NETWORK;

/**
 * Wallet state returned after a successful connection.
 *
 * Field names match the @midnight-ntwrk/dapp-connector-api v4 shape:
 * - `coinPublicKey` comes from `shieldedAddresses.shieldedCoinPublicKey`
 * - `encryptionPublicKey` comes from `shieldedAddresses.shieldedEncryptionPublicKey`
 * - `unshieldedAddress` comes from `getUnshieldedAddress().unshieldedAddress`
 */
export interface WalletConnectionResult {
  address: string;
  coinPublicKey: string;
  encryptionPublicKey: string;
  shieldedAddress: string;
  unshieldedAddress: string;
  serviceConfig?: {
    indexerUri: string;
    indexerWsUri: string;
    proverServerUri: string;
    substrateNodeUri: string;
  } | null;
}

/**
 * Service URI config returned from the wallet.
 * Maps 1:1 with @midnight-ntwrk/dapp-connector-api Configuration.
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
        // Find any wallet (mnLace OR UUID-keyed) that advertises apiVersion 4.x.
        // CRITICAL: do NOT prefer mnLace blindly — legacy v3 Lace also exposes mnLace,
        // which would shadow a v4 wallet registered under a UUID key.
        const candidates: any[] = [];
        if (midnight.mnLace) candidates.push(midnight.mnLace);
        for (const key of Object.keys(midnight)) {
          if (key === 'mnLace') continue;
          candidates.push(midnight[key]);
        }
        const lace = candidates.find(
          (w: any) => w && typeof w?.apiVersion === 'string' && w.apiVersion.startsWith('4.')
        );
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
      args: [WALLET_NETWORK_ID],
      func: async (networkId: string) => {
        const midnight = (window as any).midnight;
        if (!midnight) {
          return { __error: 'window.midnight not found. Is the Lace wallet extension installed and enabled?' };
        }

        // Find a v4-compatible wallet. Do NOT prefer mnLace blindly: legacy v3 Lace
        // also exposes mnLace and would shadow a v4 UUID-keyed wallet.
        const candidates: any[] = [];
        if (midnight.mnLace) candidates.push(midnight.mnLace);
        for (const key of Object.keys(midnight)) {
          if (key === 'mnLace') continue;
          candidates.push(midnight[key]);
        }
        const lace = candidates.find(
          (w: any) => w && typeof w?.apiVersion === 'string' && w.apiVersion.startsWith('4.')
        );
        if (!lace) {
          return { __error: 'No v4-compatible Midnight wallet found. Please install or upgrade to Lace v4+.' };
        }

        try {
          if (typeof lace.connect !== 'function') {
            return { __error: `Wallet "${lace.name}" has no connect() method.` };
          }
          const api: any = await lace.connect(networkId);
          // M2 (6.5b review): best-effort seed of the ConnectedAPI cache so subsequent
          // balanceTx / submitTx / signChallenge / getConfiguration calls can reuse
          // this handshake. Tolerates absent window (test env).
          try {
            if (typeof window !== 'undefined') {
              (window as any)[`__aliasvaultLaceApi_${networkId}_${lace.apiVersion}`] = api;
            }
          } catch { /* best-effort */ }

          // Lace v4+ API: getShieldedAddresses() returns
          //   { shieldedAddress, shieldedCoinPublicKey, shieldedEncryptionPublicKey }
          // getUnshieldedAddress() returns { unshieldedAddress: string }
          // Per @midnight-ntwrk/dapp-connector-api@4.0.1 api.d.ts
          const shieldedAddresses = typeof api.getShieldedAddresses === 'function'
            ? await api.getShieldedAddresses()
            : null;
          const unshieldedResult = typeof api.getUnshieldedAddress === 'function'
            ? await api.getUnshieldedAddress()
            : null;
          const unshieldedAddress: string =
            typeof unshieldedResult === 'string'
              ? unshieldedResult
              : (unshieldedResult?.unshieldedAddress ?? '');

          const shieldedAddress: string = shieldedAddresses?.shieldedAddress ?? '';
          const displayAddress = shieldedAddress || unshieldedAddress;
          if (!displayAddress) {
            return { __error: 'Could not retrieve wallet address.' };
          }

          // SDK WalletProvider.getCoinPublicKey()/getEncryptionPublicKey() expect
          // Bech32m strings from the shielded address set, not the unshielded address.
          const coinPublicKey: string = shieldedAddresses?.shieldedCoinPublicKey ?? '';
          const encryptionPublicKey: string = shieldedAddresses?.shieldedEncryptionPublicKey ?? '';

          // v4: Get service config from connected wallet (indexer, proof server URLs).
          // Configuration shape: { indexerUri, indexerWsUri, proverServerUri?, substrateNodeUri, networkId }
          let serviceConfig = null;
          if (typeof api.getConfiguration === 'function') {
            try {
              const config = await api.getConfiguration();
              serviceConfig = {
                indexerUri: config?.indexerUri ? String(config.indexerUri) : '',
                indexerWsUri: config?.indexerWsUri ? String(config.indexerWsUri) : '',
                proverServerUri: config?.proverServerUri ? String(config.proverServerUri) : '',
                substrateNodeUri: config?.substrateNodeUri ? String(config.substrateNodeUri) : '',
              };
            } catch {
              // getConfiguration failed — will use hardcoded fallbacks
            }
          }

          return {
            address: String(displayAddress),
            coinPublicKey,
            encryptionPublicKey,
            shieldedAddress,
            unshieldedAddress,
            serviceConfig,
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

    const connectionResult = result as WalletConnectionResult;

    // M1 (6.5b review): proverServerUri is @deprecated in dapp-connector-api@4.0.1.
    // If Lace omitted it, we'll silently fall back to the hardcoded networkConfig URL
    // in getWalletNetworkConfig(), which may not match the wallet's actual proving setup.
    // Warn loudly here so the missing field is visible during development. The permanent
    // fix is to migrate to connectedAPI.getProvingProvider() — TODO(6.5b M1) tracking.
    if (connectionResult.serviceConfig && !connectionResult.serviceConfig.proverServerUri) {
      console.warn(
        '[Wallet] Lace getConfiguration().proverServerUri is missing or empty. ' +
        'This field is @deprecated in dapp-connector-api@4.0.1; getProvingProvider() is the replacement. ' +
        'Until migration (6.5b M1), proof requests will use the hardcoded fallback from networkConfig.ts ' +
        `for network="${WALLET_NETWORK_ID}" — verify that matches the wallet's actual proving setup.`
      );
    }

    // Store wallet state for proxy providers (H1: use stored tab ID, not active tab)
    await setWalletState({
      coinPublicKey: connectionResult.coinPublicKey,
      encryptionPublicKey: connectionResult.encryptionPublicKey,
      shieldedAddress: connectionResult.shieldedAddress,
      unshieldedAddress: connectionResult.unshieldedAddress,
      activeTabId: tab.tabId,
      networkId: WALLET_NETWORK_ID,
      serviceConfig: connectionResult.serviceConfig ?? undefined,
    });

    return { success: true, data: connectionResult };
  } catch (err: any) {
    console.error('Failed to connect Lace wallet:', err);
    return { success: false, error: err?.message ?? 'Failed to connect to Lace wallet.' };
  }
}

/**
 * Result from signing a challenge message.
 *
 * Security note (2026-04-18): the previous implementation had a `'connection-proof'`
 * fallback that returned a pseudo-signature of the form `connection-proof:<addr>:<challenge>`
 * when `signData()` failed or was unavailable. That fallback bypassed cryptographic
 * authentication — the caller received `{ signature, authMethod: 'connection-proof' }`
 * and the popup's `WalletContext.signChallenge()` set `isVerified = true` solely on
 * `signature` truthiness. Per the 6.5b code review (M4) and owner decision, the
 * fallback has been removed entirely. `signData` MUST succeed with a real signature
 * or the challenge fails.
 */
export interface SignChallengeResult {
  signature: string;
  publicKey: string;
  challenge: string;
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
          // Find a v4-compatible wallet. Do NOT prefer mnLace blindly: legacy v3 Lace
          // also exposes mnLace and would shadow a v4 UUID-keyed wallet.
          const candidates: any[] = [];
          if (midnight.mnLace) candidates.push(midnight.mnLace);
          for (const key of Object.keys(midnight)) {
            if (key === 'mnLace') continue;
            candidates.push(midnight[key]);
          }
          const lace = candidates.find(
            (w: any) => w && typeof w?.apiVersion === 'string' && w.apiVersion.startsWith('4.')
          );
          if (!lace?.connect) {
            return { __error: 'No v4-compatible Midnight wallet with connect() found.' };
          }
          // M2 (6.5b review): best-effort cache reuse (see LaceWalletProxy).
          let api: any = null;
          const cacheKey = `__aliasvaultLaceApi_${networkId}_${lace.apiVersion}`;
          try {
            const g = typeof window !== 'undefined' ? (window as any) : null;
            if (g && g[cacheKey]) {
              const cached = g[cacheKey];
              try {
                const status = typeof cached.getConnectionStatus === 'function'
                  ? await cached.getConnectionStatus()
                  : null;
                if (status && status.status === 'connected' && status.networkId === networkId) {
                  api = cached;
                }
              } catch { /* stale cache — fall through */ }
            }
          } catch { /* no window — fall through */ }
          if (!api) {
            api = await lace.connect(networkId);
            try {
              if (typeof window !== 'undefined') (window as any)[cacheKey] = api;
            } catch { /* best-effort */ }
          }

          // Get wallet address as identity proof (v4: shieldedAddress from getShieldedAddresses)
          const shieldedAddresses = typeof api.getShieldedAddresses === 'function'
            ? await api.getShieldedAddresses()
            : null;
          const walletAddress = shieldedAddresses?.shieldedAddress ?? '';

          // v4 signData API: signData(data: string, options: { encoding, keyType }): Promise<Signature>
          // Signature shape: { data, signature, verifyingKey }
          // Per @midnight-ntwrk/dapp-connector-api@4.0.1 api.d.ts.
          //
          // Security: no fallback — signData MUST succeed with a real signature
          // (6.5b review M4). If the wallet can't sign this challenge cryptographically,
          // the connection is not an acceptable authentication substitute.
          if (typeof api.signData !== 'function') {
            return { __error: 'Wallet does not support signData — cryptographic signing is required.' };
          }

          const signed = await api.signData(challengeStr, {
            encoding: 'text',
            keyType: 'unshielded',
          });

          const sig = signed && typeof signed === 'object' ? String(signed.signature ?? '') : '';
          if (!sig || sig === 'undefined' || sig === '[object Object]') {
            return { __error: 'Wallet returned an invalid signature.' };
          }

          const verifyingKey = signed && typeof signed === 'object'
            ? String(signed.verifyingKey ?? walletAddress)
            : walletAddress;

          return {
            signature: sig,
            publicKey: String(verifyingKey),
            challenge: challengeStr,
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
      args: [WALLET_NETWORK_ID],
      func: async (networkId: string) => {
        const midnight = (window as any).midnight;
        if (!midnight) {
          return { __error: 'Midnight Lace wallet not found.' };
        }
        // Find a v4-compatible wallet. Do NOT prefer mnLace blindly: legacy v3 Lace
        // also exposes mnLace and would shadow a v4 UUID-keyed wallet.
        const candidates: any[] = [];
        if (midnight.mnLace) candidates.push(midnight.mnLace);
        for (const key of Object.keys(midnight)) {
          if (key === 'mnLace') continue;
          candidates.push(midnight[key]);
        }
        const lace = candidates.find(
          (w: any) => w && typeof w?.apiVersion === 'string' && w.apiVersion.startsWith('4.')
        );
        if (!lace) {
          return { __error: 'No v4-compatible Midnight wallet found.' };
        }

        try {
          // v4: Use connectedAPI.getConfiguration() instead of serviceUriConfig()
          // Configuration type: { indexerUri, indexerWsUri, proverServerUri?, substrateNodeUri, networkId }
          // M2 (6.5b review): best-effort cache reuse (see LaceWalletProxy).
          let api: any = null;
          const cacheKey = `__aliasvaultLaceApi_${networkId}_${lace.apiVersion}`;
          try {
            const g = typeof window !== 'undefined' ? (window as any) : null;
            if (g && g[cacheKey]) {
              const cached = g[cacheKey];
              try {
                const status = typeof cached.getConnectionStatus === 'function'
                  ? await cached.getConnectionStatus()
                  : null;
                if (status && status.status === 'connected' && status.networkId === networkId) {
                  api = cached;
                }
              } catch { /* stale cache — fall through */ }
            }
          } catch { /* no window — fall through */ }
          if (!api) {
            api = await lace.connect(networkId);
            try {
              if (typeof window !== 'undefined') (window as any)[cacheKey] = api;
            } catch { /* best-effort */ }
          }
          const config = await api.getConfiguration();
          return {
            indexerUri: config?.indexerUri ? String(config.indexerUri) : '',
            indexerWsUri: config?.indexerWsUri ? String(config.indexerWsUri) : '',
            proverServerUri: config?.proverServerUri ? String(config.proverServerUri) : '',
            substrateNodeUri: config?.substrateNodeUri ? String(config.substrateNodeUri) : '',
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

    const uris = result as WalletServiceUris;

    // M1 (6.5b review): same deprecation warning as handleConnectLaceWallet.
    // proverServerUri is @deprecated — migrate to getProvingProvider() eventually.
    if (!uris.proverServerUri) {
      console.warn(
        '[Wallet] Lace getConfiguration().proverServerUri is missing on getWalletServiceUris. ' +
        '@deprecated in dapp-connector-api@4.0.1; use getProvingProvider() (6.5b M1 tracking).'
      );
    }

    return { success: true, data: uris };
  } catch (err: any) {
    console.error('Failed to get wallet service URIs:', err);
    return { success: false, error: err?.message ?? 'Failed to get wallet service URIs.' };
  }
}
