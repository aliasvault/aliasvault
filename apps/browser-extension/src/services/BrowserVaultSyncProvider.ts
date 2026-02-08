/**
 * Browser extension implementation of VaultSyncProvider.
 * Wires PinataBrowserProvider + MidnightContractService + VaultCidStore
 * into the shared VaultSyncService (ADR-003: shared business logic).
 *
 * Implements the VaultSyncProvider interface from @aliasvault/vault-sync
 * so VaultSyncService orchestrates the pipeline without platform coupling.
 */

import { PinataBrowserProvider } from './PinataBrowserProvider';
import { VaultCidStore } from './VaultCidStore';
import type { MidnightContractService } from './MidnightContractService';
import type { VaultSyncProvider } from '@/utils/dist/shared/vault-sync';

/**
 * Browser extension VaultSyncProvider implementation.
 * Uses PinataBrowserProvider for IPFS, MidnightContractService for contract,
 * VaultCidStore for local CID persistence.
 */
export class BrowserVaultSyncProvider implements VaultSyncProvider {
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
   * Upload encrypted vault bytes to IPFS via Pinata.
   * CIDv1 validation and retry are handled by PinataBrowserProvider.
   */
  async uploadToIpfs(data: Uint8Array): Promise<string> {
    return this.pinataProvider.upload(data);
  }

  /**
   * Update the on-chain CID hash via VaultRegistry contract.
   */
  async updateContractCidHash(cidHash: Uint8Array): Promise<void> {
    await this.contractService.updateVaultOnChain(cidHash);
  }

  /**
   * Persist CID and CID hash to chrome.storage.local.
   */
  async persistCid(cid: string, cidHash: string): Promise<void> {
    await VaultCidStore.set(cid, cidHash);
  }
}
