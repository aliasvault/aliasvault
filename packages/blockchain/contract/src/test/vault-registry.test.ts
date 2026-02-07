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
    expect(Buffer.from(ledgerAfter.vaultCidHash)).toEqual(Buffer.from(new Uint8Array(32)));
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
      const simulator = new VaultRegistrySimulator(makeSecretKey());
      simulator.registerVault(makeAddrHash(0x01));

      const cidHash = crypto.createHash("sha256").update("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi").digest();
      const ledgerAfter = simulator.updateVault(cidHash);
      expect(Buffer.from(ledgerAfter.vaultCidHash)).toEqual(Buffer.from(cidHash));
    });

    it("non-owner cannot updateVault", () => {
      const ownerSk = makeSecretKey();
      const attackerSk = makeSecretKey();

      // Owner registers — sets owner commitment in contract state
      const ownerSim = new VaultRegistrySimulator(ownerSk);
      ownerSim.registerVault(makeAddrHash(0x01));

      // Create attacker simulator and inject owner's contract state with attacker's private state.
      // This simulates an attacker who knows the contract address but has a different secret key.
      const attackerSim = new VaultRegistrySimulator(attackerSk);
      attackerSim.circuitContext = createCircuitContext(
        sampleContractAddress(),
        ownerSim.circuitContext.currentZswapLocalState,
        ownerSim.circuitContext.currentQueryContext.state,
        attackerSim.circuitContext.currentPrivateState, // attacker's private state (different sk)
      );

      // Attacker tries to updateVault on owner's contract — should fail
      const cidHash = crypto.createHash("sha256").update("attack-cid").digest();
      expect(() => attackerSim.updateVault(cidHash)).toThrow();
    });

    it("getVaultCID returns correct private CID hash after update", () => {
      const simulator = new VaultRegistrySimulator(makeSecretKey());
      simulator.registerVault(makeAddrHash(0x01));

      const cidHash1 = crypto.createHash("sha256").update("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi").digest();
      simulator.updateVault(cidHash1);
      expect(Buffer.from(simulator.getLedger().vaultCidHash)).toEqual(Buffer.from(cidHash1));

      // Update again with a different CID
      const cidHash2 = crypto.createHash("sha256").update("bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenora").digest();
      simulator.updateVault(cidHash2);
      expect(Buffer.from(simulator.getLedger().vaultCidHash)).toEqual(Buffer.from(cidHash2));
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
