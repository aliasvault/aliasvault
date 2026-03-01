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
    });

    it("clears backupWallets via resetToDefault() on transfer", () => {
      const backupKey = makeSecretKey();
      const { sim } = createRegisteredOwner(undefined, backupKey);
      const commitment = VaultRegistrySimulator.backupCommitment(backupKey);
      sim.addBackupWallet(commitment, 1n);
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
    it("owner can add a backup wallet with timestamp", () => {
      const { sim } = createRegisteredOwner();
      const bk = makeSecretKey();
      const commitment = VaultRegistrySimulator.backupCommitment(bk);
      const ledgerAfter = sim.addBackupWallet(commitment, 1n);
      expect(ledgerAfter.backupWallets.member(commitment)).toBe(true);
      expect(ledgerAfter.backupWallets.lookup(commitment)).toEqual(1n);
    });

    it("owner can remove a backup wallet", () => {
      const { sim } = createRegisteredOwner();
      const bk = makeSecretKey();
      const commitment = VaultRegistrySimulator.backupCommitment(bk);
      sim.addBackupWallet(commitment, 1n);
      const ledgerAfter = sim.removeBackupWallet(commitment);
      expect(ledgerAfter.backupWallets.member(commitment)).toBe(false);
    });

    it("rejects zero timestamp (sentinel collision)", () => {
      const { sim } = createRegisteredOwner();
      const bk = makeSecretKey();
      const commitment = VaultRegistrySimulator.backupCommitment(bk);
      // 0 is the sentinel for "not registered" — must be rejected
      expect(() => sim.addBackupWallet(commitment, 0n)).toThrow();
    });

    it("non-owner cannot add a backup wallet", () => {
      const { sim: ownerSim } = createRegisteredOwner();
      const attackerSim = createAttackerContext(ownerSim, makeSecretKey());
      const commitment = VaultRegistrySimulator.backupCommitment(makeSecretKey());
      expect(() => attackerSim.addBackupWallet(commitment, 1n)).toThrow();
    });

    it("non-owner cannot remove a backup wallet", () => {
      const { sim: ownerSim } = createRegisteredOwner();
      const bk = makeSecretKey();
      const commitment = VaultRegistrySimulator.backupCommitment(bk);
      ownerSim.addBackupWallet(commitment, 1n);

      const attackerSim = createAttackerContext(ownerSim, makeSecretKey());
      expect(() => attackerSim.removeBackupWallet(commitment)).toThrow();
    });
  });

  describe("backupTransfer", () => {
    it("rejects if caller is not a backup wallet", () => {
      const { sim: ownerSim } = createRegisteredOwner();
      const attackerBk = makeSecretKey();
      const attackerSim = createAttackerContext(ownerSim, makeSecretKey(), attackerBk);
      const newOwnerCommitment = VaultRegistrySimulator.ownerCommitment(makeSecretKey());
      expect(() => attackerSim.backupTransfer(newOwnerCommitment)).toThrow();
    });

    it.skip("rejects if maturation period not elapsed (simulator blockTimeGte always returns true)", () => {
      // Simulator's blockTimeGte() always returns true regardless of the timestamp argument.
      // This means the maturation period check (blockTimeGte(registeredAt + 259200)) cannot
      // be tested in the simulator. Requires E2E on a local Midnight network with actual block time.
      const backupKey = makeSecretKey();
      const { sim } = createRegisteredOwner(undefined, backupKey);
      const backupCommitment = VaultRegistrySimulator.backupCommitment(backupKey);
      sim.addBackupWallet(backupCommitment, 1n);
      const newOwnerCommitment = VaultRegistrySimulator.ownerCommitment(makeSecretKey());
      expect(() => sim.backupTransfer(newOwnerCommitment)).toThrow();
    });

    it.skip("transfers ownership when called by mature backup wallet (requires block-time mocking or E2E)", () => {
      // Placeholder: when simulator supports setBlockTime(), implement:
      // 1. Owner registers, adds backup wallet with registeredAt=T
      // 2. Advance block time to T + 259200 + 1
      // 3. Backup wallet calls backupTransfer(newOwnerCommitment)
      // 4. Verify owner == newOwnerCommitment
    });

    it.skip("clears all backup wallets and recovery state after transfer (requires block-time mocking or E2E)", () => {
      // Placeholder: same block-time limitation
      // After successful backupTransfer:
      // - backupWallets should be empty
      // - recoveryKeyHash should be default<Bytes<32>>
    });

    it.skip("full maturity flow (requires block-time mocking or E2E)", () => {
      // Full flow: register → add backup → wait 72h → backupTransfer → verify
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

});
