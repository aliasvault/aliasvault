/**
 * Lace Midnight Proxy — implements MidnightProvider by proxying submitTx()
 * to the Lace wallet extension running in the page's MAIN world.
 *
 * Uses chrome.scripting.executeScript to cross the process boundary.
 *
 * H1 Security: Always targets the stored wallet-connected tab ID,
 * NOT the current active tab.
 *
 * Pattern: guardian-portal/src/services/midnightService.ts lines 117-122
 * Transaction ID is extracted from tx.identifiers(), NOT from Lace
 * (Lace's submitTransaction returns void).
 */

import { getWalletState } from './WalletState';
import { toHex } from '@midnight-ntwrk/compact-runtime';

export class LaceMidnightProxy {
  /**
   * Submit a finalized (balanced + signed) transaction via Lace wallet.
   *
   * Flow: serialize tx → toHex → send to page context → Lace submits →
   *       extract txId from tx.identifiers() → return TransactionId
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async submitTx(tx: any): Promise<string> {
    const state = await getWalletState();
    if (!state) {
      throw new Error('Lace wallet not connected. Please connect your wallet and try again.');
    }

    const txHex = toHex(tx.serialize());

    let results;
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId: state.activeTabId },
        world: 'MAIN' as chrome.scripting.ExecutionWorld,
        args: [txHex, state.networkId],
        func: async (txHexStr: string, networkId: string) => {
          try {
            const midnight = (window as any).midnight;
            if (!midnight) {
              return { __error: 'Midnight Lace wallet not found on this page.' };
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
            if (!lace?.connect) {
              return { __error: 'No v4-compatible Midnight wallet with connect() found.' };
            }

            // M2 (6.5b review): best-effort cache of the ConnectedAPI (see LaceWalletProxy).
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
            // submitTransaction returns void — txId is extracted from the tx object
            await api.submitTransaction(txHexStr);
            return { success: true };
          } catch (e: any) {
            return { __error: e?.message ?? 'Lace submitTx failed.' };
          }
        },
      });
    } catch (err: any) {
      throw new Error(
        `Wallet tab no longer available (tab ${state.activeTabId}). Please re-connect your Lace wallet. Original: ${err?.message}`
      );
    }

    const result = results?.[0]?.result;
    if (!result) {
      throw new Error('No response from Lace wallet during submitTx.');
    }
    if (result.__error) {
      throw new Error(result.__error);
    }

    // Extract transaction ID from the tx object itself (not from Lace response)
    // Pattern: guardian-portal — tx.identifiers()[0]
    const txIdentifiers = tx.identifiers();
    const txId = txIdentifiers[0];

    if (!txId) {
      throw new Error('No transaction identifier found in submitted transaction.');
    }

    return txId;
  }
}
