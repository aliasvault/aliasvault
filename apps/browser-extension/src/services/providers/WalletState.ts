/**
 * Wallet state captured during Lace connection.
 *
 * Stores the wallet's public keys and the tab ID from which the connection
 * was made. The tab ID is critical for proxy providers — they must target
 * the stored wallet-connected tab, NOT the current active tab (H1 security).
 *
 * Stored in chrome.storage.session for persistence across service worker restarts.
 */

import { storage } from 'wxt/utils/storage';

export interface LaceWalletState {
  /** Bech32m-encoded shielded coin public key (from getShieldedAddresses().shieldedCoinPublicKey). */
  coinPublicKey: string;
  /** Bech32m-encoded shielded encryption public key (from getShieldedAddresses().shieldedEncryptionPublicKey). */
  encryptionPublicKey: string;
  /** Bech32m-encoded shielded address (from getShieldedAddresses().shieldedAddress). */
  shieldedAddress: string;
  /** Bech32m-encoded unshielded address (from getUnshieldedAddress().unshieldedAddress). */
  unshieldedAddress: string;
  activeTabId: number;
  networkId: string;
  serviceConfig?: {
    indexerUri: string;
    indexerWsUri: string;
    proverServerUri: string;
    substrateNodeUri: string;
  };
}

const WALLET_STATE_KEY = 'session:laceWalletState';

/**
 * Store the wallet state after a successful Lace connection.
 */
export async function setWalletState(state: LaceWalletState): Promise<void> {
  await storage.setItem(WALLET_STATE_KEY, state);
}

/**
 * Get the stored wallet state. Returns null if no wallet is connected.
 */
export async function getWalletState(): Promise<LaceWalletState | null> {
  const state = await storage.getItem(WALLET_STATE_KEY) as LaceWalletState | null;
  return state;
}

/**
 * Clear the wallet state (on disconnect or logout).
 */
export async function clearWalletState(): Promise<void> {
  await storage.removeItem(WALLET_STATE_KEY);
}
