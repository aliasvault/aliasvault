import { AliasRegistrySimulator } from "./alias-registry-simulator.js";
import { VaultRegistrySimulator } from "./vault-registry-simulator.js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { createCircuitContext, sampleContractAddress } from "@midnight-ntwrk/compact-runtime";
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";

setNetworkId("undeployed");

const makeSecretKey = (): Uint8Array => crypto.randomBytes(32);
const makeAliasHash = (seed: number): Uint8Array => {
  const hash = new Uint8Array(32);
  hash[0] = seed;
  return hash;
};
const SAMPLE_CONTRACT_ADDR = "0200000000000000000000000000000000000000000000000000000000000001";

/**
 * Helper: create a simulator that has already claimed an alias.
 */
const createClaimedAlias = (sk?: Uint8Array, aliasHash?: Uint8Array, contractAddr?: string) => {
  const secretKey = sk ?? makeSecretKey();
  const hash = aliasHash ?? makeAliasHash(0x01);
  const addr = contractAddr ?? SAMPLE_CONTRACT_ADDR;
  const sim = new AliasRegistrySimulator(secretKey);
  sim.claimAlias(hash, addr);
  return { sim, secretKey, aliasHash: hash, contractAddr: addr };
};

/**
 * Helper: inject attacker's private state into owner's contract state.
 */
const createAttackerContext = (
  ownerSim: AliasRegistrySimulator,
  attackerSk: Uint8Array,
) => {
  const attackerSim = new AliasRegistrySimulator(attackerSk);
  attackerSim.circuitContext = createCircuitContext(
    sampleContractAddress(),
    ownerSim.circuitContext.currentZswapLocalState,
    ownerSim.circuitContext.currentQueryContext.state,
    attackerSim.circuitContext.currentPrivateState,
  );
  return attackerSim;
};

describe("AliasRegistry smart contract", () => {
  describe("claimAlias", () => {
    it("can claim an unclaimed alias", () => {
      const sim = new AliasRegistrySimulator(makeSecretKey());
      const ledgerAfter = sim.claimAlias(makeAliasHash(0x01), SAMPLE_CONTRACT_ADDR);
      expect(ledgerAfter.totalClaimCount).toEqual(1n);
    });

    it("stores correct owner commitment", () => {
      const sk = makeSecretKey();
      const sim = new AliasRegistrySimulator(sk);
      const aliasHash = makeAliasHash(0x01);
      sim.claimAlias(aliasHash, SAMPLE_CONTRACT_ADDR);

      const storedOwner = sim.getOwner(aliasHash);
      const expectedCommitment = AliasRegistrySimulator.ownerCommitment(sk);
      expect(Buffer.from(storedOwner)).toEqual(Buffer.from(expectedCommitment));
    });

    it("stores correct contract address", () => {
      const sim = new AliasRegistrySimulator(makeSecretKey());
      const aliasHash = makeAliasHash(0x01);
      const addr = "0200000000000000000000000000000000000000000000000000000000000099";
      sim.claimAlias(aliasHash, addr);

      const storedAddr = sim.getContractAddress(aliasHash);
      expect(storedAddr).toEqual(addr);
    });

    it("rejects already-claimed alias", () => {
      const { sim, aliasHash } = createClaimedAlias();
      // Different user tries to claim the same alias
      const attackerSim = createAttackerContext(sim, makeSecretKey());
      expect(() => attackerSim.claimAlias(aliasHash, SAMPLE_CONTRACT_ADDR)).toThrow();
    });

    it("single user can claim multiple aliases", () => {
      const sk = makeSecretKey();
      const sim = new AliasRegistrySimulator(sk);
      const hash1 = makeAliasHash(0x10);
      const hash2 = makeAliasHash(0x20);
      sim.claimAlias(hash1, SAMPLE_CONTRACT_ADDR);
      const ledgerAfter = sim.claimAlias(hash2, SAMPLE_CONTRACT_ADDR);

      expect(ledgerAfter.totalClaimCount).toEqual(2n);
      expect(sim.getLedger().aliasOwners.member(hash1)).toBe(true);
      expect(sim.getLedger().aliasOwners.member(hash2)).toBe(true);
      // Both point to same VaultRegistry contract address
      expect(sim.getContractAddress(hash1)).toEqual(SAMPLE_CONTRACT_ADDR);
      expect(sim.getContractAddress(hash2)).toEqual(SAMPLE_CONTRACT_ADDR);
    });

    it("different users can claim different aliases", () => {
      const sk1 = makeSecretKey();
      const sim1 = new AliasRegistrySimulator(sk1);
      sim1.claimAlias(makeAliasHash(0x01), SAMPLE_CONTRACT_ADDR);

      // Second user claims a different alias on the same contract state
      const sk2 = makeSecretKey();
      const sim2 = createAttackerContext(sim1, sk2);
      const ledgerAfter = sim2.claimAlias(makeAliasHash(0x02), SAMPLE_CONTRACT_ADDR);
      expect(ledgerAfter.totalClaimCount).toEqual(2n);
    });
  });

  describe("getOwner", () => {
    it("returns owner commitment for claimed alias", () => {
      const sk = makeSecretKey();
      const { sim, aliasHash } = createClaimedAlias(sk);
      const owner = sim.getOwner(aliasHash);
      const expected = AliasRegistrySimulator.ownerCommitment(sk);
      expect(Buffer.from(owner)).toEqual(Buffer.from(expected));
    });

    it("returns false membership for unclaimed alias", () => {
      // Simulator Map.lookup throws for non-existent keys (on-chain returns default).
      // Verify absence via ledger membership check instead.
      const sim = new AliasRegistrySimulator(makeSecretKey());
      expect(sim.getLedger().aliasOwners.member(makeAliasHash(0xFF))).toBe(false);
    });
  });

  describe("getContractAddress", () => {
    it("returns contract address for claimed alias", () => {
      const addr = "0200000000000000000000000000000000000000000000000000000000000042";
      const { sim, aliasHash } = createClaimedAlias(undefined, undefined, addr);
      const storedAddr = sim.getContractAddress(aliasHash);
      expect(storedAddr).toEqual(addr);
    });

    it("returns false membership for unclaimed alias", () => {
      // Simulator Map.lookup throws for non-existent keys (on-chain returns default).
      // Verify absence via ledger membership check instead.
      const sim = new AliasRegistrySimulator(makeSecretKey());
      expect(sim.getLedger().aliasContracts.member(makeAliasHash(0xFF))).toBe(false);
    });
  });

  describe("releaseAlias", () => {
    it("owner can release their alias", () => {
      const { sim, aliasHash } = createClaimedAlias();
      sim.releaseAlias(aliasHash);
      // Verify via ledger membership — Map.lookup throws for removed keys in simulator
      expect(sim.getLedger().aliasOwners.member(aliasHash)).toBe(false);
      expect(sim.getLedger().aliasContracts.member(aliasHash)).toBe(false);
    });

    it("non-owner cannot release alias", () => {
      const { sim, aliasHash } = createClaimedAlias();
      const attackerSim = createAttackerContext(sim, makeSecretKey());
      expect(() => attackerSim.releaseAlias(aliasHash)).toThrow();
    });

    it("released alias can be re-claimed", () => {
      const { sim, aliasHash, contractAddr } = createClaimedAlias();
      sim.releaseAlias(aliasHash);

      // Re-claim with a different user
      const newSk = makeSecretKey();
      const newSim = createAttackerContext(sim, newSk);
      const newAddr = "0200000000000000000000000000000000000000000000000000000000000077";
      newSim.claimAlias(aliasHash, newAddr);

      const storedOwner = newSim.getOwner(aliasHash);
      const expectedCommitment = AliasRegistrySimulator.ownerCommitment(newSk);
      expect(Buffer.from(storedOwner)).toEqual(Buffer.from(expectedCommitment));
    });

    it("releasing unclaimed alias fails", () => {
      const sim = new AliasRegistrySimulator(makeSecretKey());
      expect(() => sim.releaseAlias(makeAliasHash(0xFF))).toThrow();
    });

    it("totalClaimCount remains monotonic after release (Counter has no decrement)", () => {
      const { sim, aliasHash } = createClaimedAlias();
      expect(sim.getLedger().totalClaimCount).toEqual(1n);
      sim.releaseAlias(aliasHash);
      // Counter stays at 1 — Compact Counter only has increment, no decrement
      expect(sim.getLedger().totalClaimCount).toEqual(1n);
    });
  });

  describe("ownerCommitment (pure circuit)", () => {
    it("deterministic for same key", () => {
      const sk = makeSecretKey();
      const c1 = AliasRegistrySimulator.ownerCommitment(sk);
      const c2 = AliasRegistrySimulator.ownerCommitment(sk);
      expect(Buffer.from(c1)).toEqual(Buffer.from(c2));
    });

    it("different from VaultRegistry ownerCommitment for same key", () => {
      const sk = makeSecretKey();
      const aliasC = AliasRegistrySimulator.ownerCommitment(sk);
      const vaultC = VaultRegistrySimulator.ownerCommitment(sk);
      expect(Buffer.from(aliasC)).not.toEqual(Buffer.from(vaultC));
    });

    it("different for different keys", () => {
      const sk1 = makeSecretKey();
      const sk2 = makeSecretKey();
      const c1 = AliasRegistrySimulator.ownerCommitment(sk1);
      const c2 = AliasRegistrySimulator.ownerCommitment(sk2);
      expect(Buffer.from(c1)).not.toEqual(Buffer.from(c2));
    });
  });

  describe("integration: full lifecycle", () => {
    it("claim -> getOwner -> getContractAddress -> release -> re-claim", () => {
      const sk1 = makeSecretKey();
      const sim = new AliasRegistrySimulator(sk1);
      const aliasHash = makeAliasHash(0x42);
      const addr1 = "0200000000000000000000000000000000000000000000000000000000000011";

      // 1. Claim
      sim.claimAlias(aliasHash, addr1);

      // 2. getOwner — should match sk1
      const owner1 = sim.getOwner(aliasHash);
      expect(Buffer.from(owner1)).toEqual(
        Buffer.from(AliasRegistrySimulator.ownerCommitment(sk1))
      );

      // 3. getContractAddress — should match addr1
      expect(sim.getContractAddress(aliasHash)).toEqual(addr1);

      // 4. Release
      sim.releaseAlias(aliasHash);
      // Verify via ledger membership — Map.lookup throws for removed keys in simulator
      expect(sim.getLedger().aliasOwners.member(aliasHash)).toBe(false);

      // 5. Re-claim by a different user
      const sk2 = makeSecretKey();
      const newSim = createAttackerContext(sim, sk2);
      const addr2 = "0200000000000000000000000000000000000000000000000000000000000022";
      newSim.claimAlias(aliasHash, addr2);

      const owner2 = newSim.getOwner(aliasHash);
      expect(Buffer.from(owner2)).toEqual(
        Buffer.from(AliasRegistrySimulator.ownerCommitment(sk2))
      );
      expect(newSim.getContractAddress(aliasHash)).toEqual(addr2);
    });
  });
});
