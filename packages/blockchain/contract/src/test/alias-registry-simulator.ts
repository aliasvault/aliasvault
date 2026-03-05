import {
  type CircuitContext,
  sampleContractAddress,
  createConstructorContext,
  createCircuitContext
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  type Ledger,
  ledger,
  pureCircuits
} from "../managed/alias-registry/contract/index.js";
import {
  type AliasRegistryPrivateState,
  aliasRegistryWitnesses,
  createAliasRegistryPrivateState
} from "../alias-registry-witnesses.js";

export class AliasRegistrySimulator {
  readonly contract: Contract<AliasRegistryPrivateState>;
  circuitContext: CircuitContext<AliasRegistryPrivateState>;

  constructor(secretKey: Uint8Array) {
    this.contract = new Contract<AliasRegistryPrivateState>(aliasRegistryWitnesses);
    const initialPrivateState = createAliasRegistryPrivateState(secretKey);
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState
    } = this.contract.initialState(
      createConstructorContext(initialPrivateState, "0".repeat(64))
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

  public getPrivateState(): AliasRegistryPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  public claimAlias(aliasHash: Uint8Array, contractAddr: string): Ledger {
    this.circuitContext = this.contract.impureCircuits.claimAlias(
      this.circuitContext,
      aliasHash,
      contractAddr
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public getOwner(aliasHash: Uint8Array): Uint8Array {
    const result = this.contract.impureCircuits.getOwner(
      this.circuitContext,
      aliasHash
    );
    this.circuitContext = result.context;
    return result.result as unknown as Uint8Array;
  }

  public getContractAddress(aliasHash: Uint8Array): string {
    const result = this.contract.impureCircuits.getContractAddress(
      this.circuitContext,
      aliasHash
    );
    this.circuitContext = result.context;
    return result.result as unknown as string;
  }

  public releaseAlias(aliasHash: Uint8Array): Ledger {
    this.circuitContext = this.contract.impureCircuits.releaseAlias(
      this.circuitContext,
      aliasHash
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public static ownerCommitment(sk: Uint8Array): Uint8Array {
    return pureCircuits.ownerCommitment(sk);
  }
}
