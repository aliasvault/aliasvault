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
} from "../managed/guardian-recovery/contract/index.js";
import {
  type GuardianRecoveryPrivateState,
  guardianRecoveryWitnesses,
  createGuardianRecoveryPrivateState
} from "../guardian-recovery-witnesses.js";

/**
 * Simulator for testing the GuardianRecovery contract without a live network.
 * Mirrors the VaultRegistrySimulator pattern.
 */
export class GuardianRecoverySimulator {
  readonly contract: Contract<GuardianRecoveryPrivateState>;
  circuitContext: CircuitContext<GuardianRecoveryPrivateState>;

  constructor(secretKey: Uint8Array, guardianKey?: Uint8Array) {
    this.contract = new Contract<GuardianRecoveryPrivateState>(guardianRecoveryWitnesses);
    const initialPrivateState = createGuardianRecoveryPrivateState(secretKey, guardianKey);
    // Note: circuitContext is public so tests can inject cross-instance state for access control testing
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

  public getPrivateState(): GuardianRecoveryPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  public initialize(ownerCom: Uint8Array): Ledger {
    this.circuitContext = this.contract.impureCircuits.initialize(
      this.circuitContext,
      ownerCom
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public addGuardian(guardianCom: Uint8Array): Ledger {
    this.circuitContext = this.contract.impureCircuits.addGuardian(
      this.circuitContext,
      guardianCom
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public removeGuardian(guardianCom: Uint8Array): Ledger {
    this.circuitContext = this.contract.impureCircuits.removeGuardian(
      this.circuitContext,
      guardianCom
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public storeSharesCidHash(cidHash: Uint8Array): Ledger {
    this.circuitContext = this.contract.impureCircuits.storeSharesCidHash(
      this.circuitContext,
      cidHash
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public initiateRecovery(currentTime: bigint): Ledger {
    this.circuitContext = this.contract.impureCircuits.initiateRecovery(
      this.circuitContext,
      currentTime
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public approveRecovery(): Ledger {
    this.circuitContext = this.contract.impureCircuits.approveRecovery(
      this.circuitContext
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public claimRecovery(): Ledger {
    this.circuitContext = this.contract.impureCircuits.claimRecovery(
      this.circuitContext
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public cancelRecovery(): Ledger {
    this.circuitContext = this.contract.impureCircuits.cancelRecovery(
      this.circuitContext
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public static ownerCommitment(sk: Uint8Array): Uint8Array {
    return pureCircuits.ownerCommitment(sk);
  }

  public static guardianCommitment(gk: Uint8Array): Uint8Array {
    return pureCircuits.guardianCommitment(gk);
  }
}
