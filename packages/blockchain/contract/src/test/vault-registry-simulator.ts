import {
  type CircuitContext,
  sampleContractAddress,
  createConstructorContext,
  createCircuitContext
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  type Ledger,
  ledger
} from "../managed/vault-registry/contract/index.js";
import { type VaultRegistryPrivateState, witnesses } from "../witnesses.js";

/**
 * Simulator for testing the VaultRegistry contract without a live network.
 * Mirrors the CounterSimulator pattern from the upstream example-counter.
 */
export class VaultRegistrySimulator {
  readonly contract: Contract<VaultRegistryPrivateState>;
  circuitContext: CircuitContext<VaultRegistryPrivateState>;

  constructor() {
    this.contract = new Contract<VaultRegistryPrivateState>(witnesses);
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState
    } = this.contract.initialState(
      createConstructorContext({} as VaultRegistryPrivateState, "0".repeat(64))
    );
    this.circuitContext = createCircuitContext(
      sampleContractAddress(),
      currentZswapLocalState,
      currentContractState,
      currentPrivateState
    );
  }

  public getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public getPrivateState(): VaultRegistryPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  public registerVault(walletAddressHash: Uint8Array): Ledger {
    this.circuitContext = this.contract.impureCircuits.registerVault(
      this.circuitContext,
      walletAddressHash
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public isRegistered(walletAddressHash: Uint8Array): boolean {
    const result = this.contract.impureCircuits.isRegistered(
      this.circuitContext,
      walletAddressHash
    );
    // Update context (isRegistered is an impure circuit that creates a tx)
    this.circuitContext = result.context;
    return result.result as unknown as boolean;
  }
}
