/**
 * In-memory private state provider for the Midnight SDK.
 *
 * Implements PrivateStateProvider from @midnight-ntwrk/midnight-js-types.
 * State is keyed by `${contractAddress}:${id}` to scope entries per contract.
 * Signing keys are stored in a separate map keyed by contract address.
 *
 * Reference: bboard-ui/src/in-memory-private-state-provider.ts
 */

export class InMemoryPrivateStateProvider {
  private currentContractAddress = '';
  private readonly states = new Map<string, Uint8Array>();
  private readonly signingKeys = new Map<string, Uint8Array>();

  /**
   * Set the current contract address. Subsequent get/set/remove calls
   * are scoped to this address via composite key.
   */
  setContractAddress(address: string): void {
    this.currentContractAddress = address;
  }

  async get(id: string): Promise<Uint8Array | null> {
    const key = `${this.currentContractAddress}:${id}`;
    return this.states.get(key) ?? null;
  }

  async set(id: string, state: Uint8Array): Promise<void> {
    const key = `${this.currentContractAddress}:${id}`;
    this.states.set(key, state);
  }

  async remove(id: string): Promise<void> {
    const key = `${this.currentContractAddress}:${id}`;
    this.states.delete(key);
  }

  async clear(): Promise<void> {
    this.states.clear();
  }

  async setSigningKey(address: string, key: Uint8Array): Promise<void> {
    this.signingKeys.set(address, key);
  }

  async getSigningKey(address: string): Promise<Uint8Array | null> {
    return this.signingKeys.get(address) ?? null;
  }

  async removeSigningKey(address: string): Promise<void> {
    this.signingKeys.delete(address);
  }

  async clearSigningKeys(): Promise<void> {
    this.signingKeys.clear();
  }

  async exportPrivateStates(): Promise<Map<string, Uint8Array>> {
    throw new Error('exportPrivateStates not supported for in-memory provider');
  }

  async importPrivateStates(_states: Map<string, Uint8Array>): Promise<void> {
    throw new Error('importPrivateStates not supported for in-memory provider');
  }
}
