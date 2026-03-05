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
} from "../managed/vault-registry/contract/index.js";
import {
  type VaultRegistryPrivateState,
  vaultRegistryWitnesses,
  createVaultRegistryPrivateState
} from "../witnesses.js";

/**
 * Simulator for testing the VaultRegistry contract without a live network.
 * Mirrors the CounterSimulator pattern from the upstream example-counter.
 */
export class VaultRegistrySimulator {
  readonly contract: Contract<VaultRegistryPrivateState>;
  circuitContext: CircuitContext<VaultRegistryPrivateState>;

  constructor(secretKey: Uint8Array, backupKey?: Uint8Array, relayKey?: Uint8Array) {
    this.contract = new Contract<VaultRegistryPrivateState>(vaultRegistryWitnesses);
    const initialPrivateState = createVaultRegistryPrivateState(secretKey, backupKey, relayKey);
    // Note: circuitContext is public so tests can inject cross-instance state for access control testing (M1)
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

  public updateVault(newCidHash: Uint8Array): Ledger {
    this.circuitContext = this.contract.impureCircuits.updateVault(
      this.circuitContext,
      newCidHash
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public transferOwnership(newOwnerCommitment: Uint8Array): Ledger {
    this.circuitContext = this.contract.impureCircuits.transferOwnership(
      this.circuitContext,
      newOwnerCommitment
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public storeRecoveryKeyHash(keyHash: Uint8Array): Ledger {
    this.circuitContext = this.contract.impureCircuits.storeRecoveryKeyHash(
      this.circuitContext,
      keyHash
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public addBackupWallet(walletCommitment: Uint8Array, currentTime: bigint): Ledger {
    this.circuitContext = this.contract.impureCircuits.addBackupWallet(
      this.circuitContext,
      walletCommitment,
      currentTime
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public removeBackupWallet(walletCommitment: Uint8Array): Ledger {
    this.circuitContext = this.contract.impureCircuits.removeBackupWallet(
      this.circuitContext,
      walletCommitment
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public backupTransfer(newOwnerCommitment: Uint8Array): Ledger {
    this.circuitContext = this.contract.impureCircuits.backupTransfer(
      this.circuitContext,
      newOwnerCommitment
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public setEmailPublicKey(pubKey: Uint8Array): Ledger {
    this.circuitContext = this.contract.impureCircuits.setEmailPublicKey(
      this.circuitContext,
      pubKey
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public setMailRelay(relayCommit: Uint8Array): Ledger {
    this.circuitContext = this.contract.impureCircuits.setMailRelay(
      this.circuitContext,
      relayCommit
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public notifyNewMail(manifestCid: string): Ledger {
    this.circuitContext = this.contract.impureCircuits.notifyNewMail(
      this.circuitContext,
      manifestCid
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public isRegistered(walletAddressHash: Uint8Array): boolean {
    const result = this.contract.impureCircuits.isRegistered(
      this.circuitContext,
      walletAddressHash
    );
    this.circuitContext = result.context;
    return result.result as unknown as boolean;
  }

  public static ownerCommitment(sk: Uint8Array): Uint8Array {
    return pureCircuits.ownerCommitment(sk);
  }

  public static backupCommitment(bk: Uint8Array): Uint8Array {
    return pureCircuits.backupCommitment(bk);
  }

  public static relayCommitment(rk: Uint8Array): Uint8Array {
    return pureCircuits.relayCommitment(rk);
  }
}
