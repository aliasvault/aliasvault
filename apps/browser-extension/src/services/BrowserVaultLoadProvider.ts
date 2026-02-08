/**
 * Browser extension implementation of VaultLoadProvider.
 * Wires MidnightContractService + PinataBrowserProvider + VaultCidStore
 * into the shared VaultSyncService.loadVault() pipeline (ADR-003: shared business logic).
 *
 * Implements the VaultLoadProvider interface from @aliasvault/vault-sync
 * so VaultSyncService orchestrates the load pipeline without platform coupling.
 */

import { PinataBrowserProvider } from './PinataBrowserProvider';
import { VaultCidStore } from './VaultCidStore';
import type { MidnightContractService } from './MidnightContractService';
import type { VaultLoadProvider } from '@/utils/dist/shared/vault-sync';

/**
 * Browser extension VaultLoadProvider implementation.
 * Uses MidnightContractService for on-chain reads, PinataBrowserProvider for IPFS,
 * VaultCidStore for local CID persistence.
 */
export class BrowserVaultLoadProvider implements VaultLoadProvider {
  private readonly pinataProvider: PinataBrowserProvider;
  private readonly contractService: MidnightContractService;

  constructor(
    pinataProvider: PinataBrowserProvider,
    contractService: MidnightContractService,
  ) {
    this.pinataProvider = pinataProvider;
    this.contractService = contractService;
  }

  /**
   * Read vaultCidHash from the on-chain public ledger via indexer.
   * Returns null if not registered.
   */
  async readContractCidHash(): Promise<Uint8Array | null> {
    return this.contractService.readVaultCidHash();
  }

  /**
   * Get locally cached CID and cidHash from chrome.storage.local.
   */
  async getLocalCid(): Promise<{ cid: string | null; cidHash: string | null }> {
    return VaultCidStore.get();
  }

  /**
   * Download encrypted vault bytes from IPFS via Pinata gateway.
   * Retry is handled by PinataBrowserProvider.download().
   */
  async downloadFromIpfs(cid: string): Promise<Uint8Array> {
    return this.pinataProvider.download(cid);
  }

  /**
   * Discover CID by scanning Pinata pin list and matching SHA-256 hash.
   * Used on new devices where no local CID is cached.
   */
  async discoverCidByHash(cidHash: Uint8Array): Promise<string | null> {
    return this.pinataProvider.discoverCidByHash(cidHash);
  }

  /**
   * Persist CID and cidHash to chrome.storage.local after successful download.
   */
  async persistCid(cid: string, cidHash: string): Promise<void> {
    await VaultCidStore.set(cid, cidHash);
  }
}
