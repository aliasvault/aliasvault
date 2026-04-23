/**
 * Lace Wallet Proxy — implements WalletProvider by proxying calls
 * to the Lace wallet extension running in the page's MAIN world.
 *
 * Uses chrome.scripting.executeScript to cross the process boundary.
 * Only balanceTx() and key getters cross the boundary; secret key
 * NEVER leaves the service worker.
 *
 * H1 Security: Always targets the stored wallet-connected tab ID,
 * NOT the current active tab, to prevent injection into malicious pages.
 *
 * H2 Validation: Response hex is validated before deserialization.
 */

import { getWalletState } from './WalletState';
import { isValidHex } from '@/utils/hex';
import { toHex, fromHex } from '@midnight-ntwrk/compact-runtime';
import { Transaction } from '@midnight-ntwrk/ledger-v8';

export class LaceWalletProxy {
  /**
   * Get the coin (unshielded) public key from cached wallet state.
   */
  async getCoinPublicKey(): Promise<string> {
    const state = await getWalletState();
    if (!state) {
      throw new Error('Lace wallet not connected. Please connect your wallet and try again.');
    }
    return state.coinPublicKey;
  }

  /**
   * Get the encryption public key from cached wallet state.
   */
  async getEncryptionPublicKey(): Promise<string> {
    const state = await getWalletState();
    if (!state) {
      throw new Error('Lace wallet not connected. Please connect your wallet and try again.');
    }
    return state.encryptionPublicKey;
  }

  /**
   * Balance an unbound transaction via Lace wallet.
   *
   * Flow: serialize tx → toHex → send to page context → Lace balances →
   *       validate hex → fromHex → Transaction.deserialize → return FinalizedTransaction
   *
   * Pattern: guardian-portal/src/services/midnightService.ts lines 99-111
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async balanceTx(tx: any): Promise<any> {
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

            // M2 (6.5b review): best-effort cache of the ConnectedAPI on the tab's
            // window so we don't re-handshake (and potentially re-prompt the user) on
            // every balanceTx. `window` persists across chrome.scripting invocations
            // on the same tab. Wrapped in try/catch so a missing/frozen globalThis
            // degrades gracefully to always-handshake behavior.
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
              } catch { /* best-effort cache */ }
            }
            const received = await api.balanceUnsealedTransaction(txHexStr);
            // Lace API returns { tx: string } per ConnectedAPI interface
            const hex = typeof received === 'object' && received.tx
              ? received.tx
              : String(received);
            return { hex };
          } catch (e: any) {
            return { __error: e?.message ?? 'Lace balanceTx failed.' };
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
      throw new Error('No response from Lace wallet during balanceTx.');
    }
    if (result.__error) {
      throw new Error(result.__error);
    }

    const hex = result.hex;

    // H2: Validate response hex before deserialization
    if (!hex || hex.length === 0) {
      throw new Error('Empty response from Lace wallet balanceTx.');
    }
    if (!isValidHex(hex)) {
      throw new Error('Invalid hex response from Lace wallet balanceTx: contains non-hex characters.');
    }

    // Deserialize hex → FinalizedTransaction (same pattern as guardian-portal)
    try {
      return Transaction.deserialize(
        'signature',
        'proof',
        'binding',
        fromHex(hex),
      );
    } catch (err: any) {
      throw new Error(`Failed to deserialize balanced transaction: ${err?.message}`);
    }
  }
}
