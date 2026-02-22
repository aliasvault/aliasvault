import { VaultRegistrySimulator } from "./vault-registry-simulator.js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { createCircuitContext, sampleContractAddress } from "@midnight-ntwrk/compact-runtime";
import { describe, it, expect } from "vitest";
import { assertCIDv1 } from "../cid-utils.js";
import crypto from "node:crypto";

setNetworkId("undeployed");

const makeSecretKey = (): Uint8Array => crypto.randomBytes(32);
const makeAddrHash = (seed: number): Uint8Array => {
  const hash = new Uint8Array(32);
  hash[0] = seed;
  return hash;
};
const ZERO_BYTES_32 = new Uint8Array(32);

/**
 * Helper: create an owner simulator that has already registered a vault.
 */
const createRegisteredOwner = (sk?: Uint8Array, backupKey?: Uint8Array) => {
  const secretKey = sk ?? makeSecretKey();
  const sim = new VaultRegistrySimulator(secretKey, backupKey);
  sim.registerVault(makeAddrHash(0x01));
  return { sim, secretKey };
};

/**
 * Helper: inject attacker's private state into owner's contract state.
 */
const createAttackerContext = (
  ownerSim: VaultRegistrySimulator,
  attackerSk: Uint8Array,
  attackerBackupKey?: Uint8Array,
) => {
  const attackerSim = new VaultRegistrySimulator(attackerSk, attackerBackupKey);
  attackerSim.circuitContext = createCircuitContext(
    sampleContractAddress(),
    ownerSim.circuitContext.currentZswapLocalState,
    ownerSim.circuitContext.currentQueryContext.state,
    attackerSim.circuitContext.currentPrivateState,
  );
  return attackerSim;
};

describe("VaultRegistry smart contract", () => {
  it("generates initial ledger state deterministically", () => {
    const sk = makeSecretKey();
    const simulator0 = new VaultRegistrySimulator(sk);
    const simulator1 = new VaultRegistrySimulator(sk);
    expect(simulator0.getLedger().totalVaults).toEqual(simulator1.getLedger().totalVaults);
  });

  it("properly initializes ledger state with zero vaults", () => {
    const simulator = new VaultRegistrySimulator(makeSecretKey());
    const initialLedger = simulator.getLedger();
    expect(initialLedger.totalVaults).toEqual(0n);
  });

  it("registers a vault and increments totalVaults", () => {
    const simulator = new VaultRegistrySimulator(makeSecretKey());
    const ledgerAfter = simulator.registerVault(makeAddrHash(0x01));
    expect(ledgerAfter.totalVaults).toEqual(1n);
  });

  it("sets owner commitment on registration", () => {
    const sk = makeSecretKey();
    const simulator = new VaultRegistrySimulator(sk);
    const ledgerAfter = simulator.registerVault(makeAddrHash(0x01));

    const expectedCommitment = VaultRegistrySimulator.ownerCommitment(sk);
    expect(Buffer.from(ledgerAfter.owner)).toEqual(Buffer.from(expectedCommitment));
  });

  it("initializes vaultCidHash to zero on registration", () => {
    const simulator = new VaultRegistrySimulator(makeSecretKey());
    const ledgerAfter = simulator.registerVault(makeAddrHash(0x01));
    expect(Buffer.from(ledgerAfter.vaultCidHash)).toEqual(Buffer.from(ZERO_BYTES_32));
  });

  it("rejects duplicate vault registration", () => {
    const simulator = new VaultRegistrySimulator(makeSecretKey());
    const hash = makeAddrHash(0x42);
    simulator.registerVault(hash);
    expect(() => simulator.registerVault(hash)).toThrow();
  });

  it("allows registering different vaults", () => {
    const simulator = new VaultRegistrySimulator(makeSecretKey());
    simulator.registerVault(makeAddrHash(0x01));
    const ledgerAfter = simulator.registerVault(makeAddrHash(0x02));
    expect(ledgerAfter.totalVaults).toEqual(2n);
  });

  describe("updateVault (owner access control)", () => {
    it("owner can updateVault", () => {
      const { sim } = createRegisteredOwner();
      const cidHash = crypto.createHash("sha256").update("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi").digest();
      const ledgerAfter = sim.updateVault(cidHash);
      expect(Buffer.from(ledgerAfter.vaultCidHash)).toEqual(Buffer.from(cidHash));
    });

    it("non-owner cannot updateVault", () => {
      const { sim: ownerSim } = createRegisteredOwner();
      const attackerSim = createAttackerContext(ownerSim, makeSecretKey());
      const cidHash = crypto.createHash("sha256").update("attack-cid").digest();
      expect(() => attackerSim.updateVault(cidHash)).toThrow();
    });

    it("getVaultCID returns correct private CID hash after update", () => {
      const { sim } = createRegisteredOwner();

      const cidHash1 = crypto.createHash("sha256").update("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi").digest();
      sim.updateVault(cidHash1);
      expect(Buffer.from(sim.getLedger().vaultCidHash)).toEqual(Buffer.from(cidHash1));

      const cidHash2 = crypto.createHash("sha256").update("bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenora").digest();
      sim.updateVault(cidHash2);
      expect(Buffer.from(sim.getLedger().vaultCidHash)).toEqual(Buffer.from(cidHash2));
    });
  });

  describe("transferOwnership", () => {
    it("owner can transfer ownership", () => {
      const { sim, secretKey } = createRegisteredOwner();
      const newSk = makeSecretKey();
      const newOwnerCommitment = VaultRegistrySimulator.ownerCommitment(newSk);

      const ledgerAfter = sim.transferOwnership(newOwnerCommitment);
      expect(Buffer.from(ledgerAfter.owner)).toEqual(Buffer.from(newOwnerCommitment));
    });

    it("non-owner cannot transfer ownership", () => {
      const { sim: ownerSim } = createRegisteredOwner();
      const attackerSim = createAttackerContext(ownerSim, makeSecretKey());
      const newOwnerCommitment = VaultRegistrySimulator.ownerCommitment(makeSecretKey());
      expect(() => attackerSim.transferOwnership(newOwnerCommitment)).toThrow();
    });

    it("resets recovery state on transfer", () => {
      const { sim } = createRegisteredOwner();

      // Set some recovery state first
      const keyHash = crypto.randomBytes(32);
      sim.storeRecoveryKeyHash(keyHash);
      expect(Buffer.from(sim.getLedger().recoveryKeyHash)).toEqual(Buffer.from(keyHash));

      // Transfer ownership
      const newOwnerCommitment = VaultRegistrySimulator.ownerCommitment(makeSecretKey());
      const ledgerAfter = sim.transferOwnership(newOwnerCommitment);

      // Recovery state should be reset
      expect(Buffer.from(ledgerAfter.recoveryKeyHash)).toEqual(Buffer.from(ZERO_BYTES_32));
      expect(ledgerAfter.transferInitiatedAt).toEqual(0n);
      expect(Buffer.from(ledgerAfter.transferInitiator)).toEqual(Buffer.from(ZERO_BYTES_32));
    });

    it("clears backupWallets via resetToDefault() on transfer", () => {
      const backupKey = makeSecretKey();
      const { sim } = createRegisteredOwner(undefined, backupKey);
      const commitment = VaultRegistrySimulator.backupCommitment(backupKey);
      sim.addBackupWallet(commitment);
      expect(sim.getLedger().backupWallets.member(commitment)).toBe(true);

      const newOwnerCommitment = VaultRegistrySimulator.ownerCommitment(makeSecretKey());
      const ledgerAfter = sim.transferOwnership(newOwnerCommitment);

      expect(ledgerAfter.backupWallets.isEmpty()).toBe(true);
    });
  });

  describe("storeRecoveryKeyHash", () => {
    it("owner can store recovery key hash", () => {
      const { sim } = createRegisteredOwner();
      const keyHash = crypto.randomBytes(32);
      const ledgerAfter = sim.storeRecoveryKeyHash(keyHash);
      expect(Buffer.from(ledgerAfter.recoveryKeyHash)).toEqual(Buffer.from(keyHash));
    });

    it("owner can overwrite recovery key hash", () => {
      const { sim } = createRegisteredOwner();
      const keyHash1 = crypto.randomBytes(32);
      sim.storeRecoveryKeyHash(keyHash1);

      const keyHash2 = crypto.randomBytes(32);
      const ledgerAfter = sim.storeRecoveryKeyHash(keyHash2);
      expect(Buffer.from(ledgerAfter.recoveryKeyHash)).toEqual(Buffer.from(keyHash2));
    });

    it("non-owner cannot store recovery key hash", () => {
      const { sim: ownerSim } = createRegisteredOwner();
      const attackerSim = createAttackerContext(ownerSim, makeSecretKey());
      expect(() => attackerSim.storeRecoveryKeyHash(crypto.randomBytes(32))).toThrow();
    });
  });

  describe("backupCommitment (pure circuit)", () => {
    it("produces deterministic output for same key", () => {
      const bk = makeSecretKey();
      const c1 = VaultRegistrySimulator.backupCommitment(bk);
      const c2 = VaultRegistrySimulator.backupCommitment(bk);
      expect(Buffer.from(c1)).toEqual(Buffer.from(c2));
    });

    it("produces different commitment than ownerCommitment for same key", () => {
      const key = makeSecretKey();
      const ownerC = VaultRegistrySimulator.ownerCommitment(key);
      const backupC = VaultRegistrySimulator.backupCommitment(key);
      expect(Buffer.from(ownerC)).not.toEqual(Buffer.from(backupC));
    });

    it("produces different commitments for different keys", () => {
      const bk1 = makeSecretKey();
      const bk2 = makeSecretKey();
      const c1 = VaultRegistrySimulator.backupCommitment(bk1);
      const c2 = VaultRegistrySimulator.backupCommitment(bk2);
      expect(Buffer.from(c1)).not.toEqual(Buffer.from(c2));
    });
  });

  describe("addBackupWallet / removeBackupWallet", () => {
    it("owner can add a backup wallet", () => {
      const { sim } = createRegisteredOwner();
      const bk = makeSecretKey();
      const commitment = VaultRegistrySimulator.backupCommitment(bk);
      const ledgerAfter = sim.addBackupWallet(commitment);
      expect(ledgerAfter.backupWallets.member(commitment)).toBe(true);
    });

    it("owner can remove a backup wallet", () => {
      const { sim } = createRegisteredOwner();
      const bk = makeSecretKey();
      const commitment = VaultRegistrySimulator.backupCommitment(bk);
      sim.addBackupWallet(commitment);
      const ledgerAfter = sim.removeBackupWallet(commitment);
      expect(ledgerAfter.backupWallets.member(commitment)).toBe(false);
    });

    it("non-owner cannot add a backup wallet", () => {
      const { sim: ownerSim } = createRegisteredOwner();
      const attackerSim = createAttackerContext(ownerSim, makeSecretKey());
      const commitment = VaultRegistrySimulator.backupCommitment(makeSecretKey());
      expect(() => attackerSim.addBackupWallet(commitment)).toThrow();
    });

    it("non-owner cannot remove a backup wallet", () => {
      const { sim: ownerSim } = createRegisteredOwner();
      const bk = makeSecretKey();
      const commitment = VaultRegistrySimulator.backupCommitment(bk);
      ownerSim.addBackupWallet(commitment);

      const attackerSim = createAttackerContext(ownerSim, makeSecretKey());
      expect(() => attackerSim.removeBackupWallet(commitment)).toThrow();
    });
  });

  describe("initiateBackupTransfer", () => {
    it("authorized backup wallet can initiate transfer", () => {
      const backupKey = makeSecretKey();
      const { sim } = createRegisteredOwner(undefined, backupKey);
      const backupCommitment = VaultRegistrySimulator.backupCommitment(backupKey);
      sim.addBackupWallet(backupCommitment);

      // Initiate transfer with a non-zero past timestamp (simulator block time defaults to 0)
      const ledgerAfter = sim.initiateBackupTransfer(1n);
      expect(ledgerAfter.transferInitiatedAt).toEqual(1n);
      expect(Buffer.from(ledgerAfter.transferInitiator)).toEqual(Buffer.from(backupCommitment));
    });

    it("rejects zero timestamp (sentinel collision)", () => {
      const backupKey = makeSecretKey();
      const { sim } = createRegisteredOwner(undefined, backupKey);
      const backupCommitment = VaultRegistrySimulator.backupCommitment(backupKey);
      sim.addBackupWallet(backupCommitment);

      // 0 is the sentinel for "no transfer initiated" — must be rejected
      expect(() => sim.initiateBackupTransfer(0n)).toThrow();
    });

    it("non-backup wallet cannot initiate transfer", () => {
      const { sim: ownerSim } = createRegisteredOwner();
      // No backup wallets added — should fail
      const attackerBk = makeSecretKey();
      const attackerSim = createAttackerContext(ownerSim, makeSecretKey(), attackerBk);
      expect(() => attackerSim.initiateBackupTransfer(1n)).toThrow();
    });
  });

  describe("executeBackupTransfer", () => {
    it("rejects if no transfer initiated (transferInitiatedAt == 0)", () => {
      const backupKey = makeSecretKey();
      const { sim } = createRegisteredOwner(undefined, backupKey);
      const backupCommitment = VaultRegistrySimulator.backupCommitment(backupKey);
      sim.addBackupWallet(backupCommitment);

      const newOwnerCommitment = VaultRegistrySimulator.ownerCommitment(makeSecretKey());
      // No initiateBackupTransfer called — should fail
      expect(() => sim.executeBackupTransfer(newOwnerCommitment)).toThrow();
    });

    it("rejects if caller is not the transfer initiator", () => {
      const backupKey1 = makeSecretKey();
      const backupKey2 = makeSecretKey();
      const ownerSk = makeSecretKey();

      // Owner registers with backupKey1 as the local backup key
      const sim = new VaultRegistrySimulator(ownerSk, backupKey1);
      sim.registerVault(makeAddrHash(0x01));

      // Add both backup wallets
      const commitment1 = VaultRegistrySimulator.backupCommitment(backupKey1);
      const commitment2 = VaultRegistrySimulator.backupCommitment(backupKey2);
      sim.addBackupWallet(commitment1);
      sim.addBackupWallet(commitment2);

      // Backup wallet 1 initiates transfer
      sim.initiateBackupTransfer(1n);

      // Create a sim with backupKey2 trying to execute (different initiator)
      const sim2 = new VaultRegistrySimulator(ownerSk, backupKey2);
      sim2.circuitContext = createCircuitContext(
        sampleContractAddress(),
        sim.circuitContext.currentZswapLocalState,
        sim.circuitContext.currentQueryContext.state,
        sim2.circuitContext.currentPrivateState,
      );

      const newOwnerCommitment = VaultRegistrySimulator.ownerCommitment(makeSecretKey());
      expect(() => sim2.executeBackupTransfer(newOwnerCommitment)).toThrow();
    });
  });

  describe("cancelBackupTransfer", () => {
    it("owner can cancel a pending backup transfer", () => {
      const backupKey = makeSecretKey();
      const { sim } = createRegisteredOwner(undefined, backupKey);
      const backupCommitment = VaultRegistrySimulator.backupCommitment(backupKey);
      sim.addBackupWallet(backupCommitment);
      sim.initiateBackupTransfer(1n);

      // Verify transfer was initiated
      expect(Buffer.from(sim.getLedger().transferInitiator)).toEqual(Buffer.from(backupCommitment));

      // Owner cancels
      const ledgerAfter = sim.cancelBackupTransfer();
      expect(ledgerAfter.transferInitiatedAt).toEqual(0n);
      expect(Buffer.from(ledgerAfter.transferInitiator)).toEqual(Buffer.from(ZERO_BYTES_32));
    });

    it("non-owner cannot cancel a backup transfer", () => {
      const backupKey = makeSecretKey();
      const { sim: ownerSim } = createRegisteredOwner(undefined, backupKey);
      const backupCommitment = VaultRegistrySimulator.backupCommitment(backupKey);
      ownerSim.addBackupWallet(backupCommitment);
      ownerSim.initiateBackupTransfer(1n);

      const attackerSim = createAttackerContext(ownerSim, makeSecretKey());
      expect(() => attackerSim.cancelBackupTransfer()).toThrow();
    });
  });

  describe("CIDv1 validation", () => {
    // Imports the canonical assertCIDv1 from contract/src/cid-utils.ts (M2 fix)
    it("rejects CIDv0 format (starts with Qm)", () => {
      expect(() => assertCIDv1("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG")).toThrow("CIDv0 detected");
    });

    it("rejects non-base32 CID format", () => {
      expect(() => assertCIDv1("BAFY...")).toThrow("base32 encoded");
    });

    it("accepts valid CIDv1 format", () => {
      expect(() => assertCIDv1("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi")).not.toThrow();
    });
  });

  describe("executeBackupTransfer — positive flow", () => {
    // H3: The simulator's block time defaults to 0, making blockTimeGte(unlockTime)
    // impossible to satisfy with a real timestamp + 72-hour offset. A positive test
    // requires either simulator block-time mocking (not currently supported by
    // compact-runtime) or E2E on a local Midnight network with actual block time.
    // The TUI (tui_vault_registry.ts) covers this flow manually on a live network.
    it.skip("full initiate → wait → execute flow (requires block-time mocking or E2E)", () => {
      // Placeholder: when simulator supports setBlockTime(), implement:
      // 1. Owner registers, adds backup wallet
      // 2. Backup wallet calls initiateBackupTransfer(now)
      // 3. Advance block time by 72+ hours
      // 4. Backup wallet calls executeBackupTransfer(newOwnerCommitment)
      // 5. Verify owner == newOwnerCommitment
    });
  });
});
