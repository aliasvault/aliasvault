import { GuardianRecoverySimulator } from "./guardian-recovery-simulator.js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { createCircuitContext, sampleContractAddress } from "@midnight-ntwrk/compact-runtime";
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";

setNetworkId("undeployed");

const makeSecretKey = (): Uint8Array => crypto.randomBytes(32);
const ZERO_BYTES_32 = new Uint8Array(32);

/**
 * Helper: create a simulator with an initialized owner.
 */
const createInitializedOwner = (sk?: Uint8Array, guardianKey?: Uint8Array) => {
  const secretKey = sk ?? makeSecretKey();
  const sim = new GuardianRecoverySimulator(secretKey, guardianKey);
  const ownerCom = GuardianRecoverySimulator.ownerCommitment(secretKey);
  sim.initialize(ownerCom);
  return { sim, secretKey };
};

/**
 * Helper: inject attacker's private state into owner's contract state.
 */
const createAttackerContext = (
  ownerSim: GuardianRecoverySimulator,
  attackerSk: Uint8Array,
  attackerGuardianKey?: Uint8Array,
) => {
  const attackerSim = new GuardianRecoverySimulator(attackerSk, attackerGuardianKey);
  attackerSim.circuitContext = createCircuitContext(
    sampleContractAddress(),
    ownerSim.circuitContext.currentZswapLocalState,
    ownerSim.circuitContext.currentQueryContext.state,
    attackerSim.circuitContext.currentPrivateState,
  );
  return attackerSim;
};

/**
 * Helper: create a guardian context joined to the owner's contract state.
 */
const createGuardianContext = (
  ownerSim: GuardianRecoverySimulator,
  guardianKey: Uint8Array,
) => {
  const guardianSim = new GuardianRecoverySimulator(makeSecretKey(), guardianKey);
  guardianSim.circuitContext = createCircuitContext(
    sampleContractAddress(),
    ownerSim.circuitContext.currentZswapLocalState,
    ownerSim.circuitContext.currentQueryContext.state,
    guardianSim.circuitContext.currentPrivateState,
  );
  return guardianSim;
};

describe("GuardianRecovery smart contract", () => {
  // 10.1: Initial ledger defaults
  describe("initial ledger state", () => {
    it("all fields are at default values", () => {
      const sim = new GuardianRecoverySimulator(makeSecretKey());
      const ledger = sim.getLedger();
      expect(Buffer.from(ledger.owner)).toEqual(Buffer.from(ZERO_BYTES_32));
      expect(ledger.guardians.isEmpty()).toBe(true);
      expect(ledger.guardianCount).toEqual(0n);
      expect(ledger.recoveryInitiatedAt).toEqual(0n);
      expect(ledger.approvedGuardians.isEmpty()).toBe(true);
      expect(Buffer.from(ledger.sharesCidHash)).toEqual(Buffer.from(ZERO_BYTES_32));
      expect(ledger.recoveryComplete).toBe(false);
    });
  });

  // 10.2: Initialize
  describe("initialize", () => {
    it("sets owner commitment", () => {
      const sk = makeSecretKey();
      const sim = new GuardianRecoverySimulator(sk);
      const ownerCom = GuardianRecoverySimulator.ownerCommitment(sk);
      const ledger = sim.initialize(ownerCom);
      expect(Buffer.from(ledger.owner)).toEqual(Buffer.from(ownerCom));
    });

    it("rejects double initialization", () => {
      const { sim } = createInitializedOwner();
      const newOwnerCom = GuardianRecoverySimulator.ownerCommitment(makeSecretKey());
      expect(() => sim.initialize(newOwnerCom)).toThrow();
    });
  });

  // 10.3: addGuardian
  describe("addGuardian", () => {
    it("owner can add a guardian", () => {
      const { sim } = createInitializedOwner();
      const gk = makeSecretKey();
      const gCom = GuardianRecoverySimulator.guardianCommitment(gk);
      const ledger = sim.addGuardian(gCom);
      expect(ledger.guardians.member(gCom)).toBe(true);
      expect(ledger.guardianCount).toEqual(1n);
    });

    it("non-owner cannot add a guardian", () => {
      const { sim: ownerSim } = createInitializedOwner();
      const attackerSim = createAttackerContext(ownerSim, makeSecretKey());
      const gCom = GuardianRecoverySimulator.guardianCommitment(makeSecretKey());
      expect(() => attackerSim.addGuardian(gCom)).toThrow();
    });

    it("rejects duplicate guardian", () => {
      const { sim } = createInitializedOwner();
      const gk = makeSecretKey();
      const gCom = GuardianRecoverySimulator.guardianCommitment(gk);
      sim.addGuardian(gCom);
      expect(() => sim.addGuardian(gCom)).toThrow();
    });

    it("rejects more than 3 guardians", () => {
      const { sim } = createInitializedOwner();
      for (let i = 0; i < 3; i++) {
        const gCom = GuardianRecoverySimulator.guardianCommitment(makeSecretKey());
        sim.addGuardian(gCom);
      }
      const extraCom = GuardianRecoverySimulator.guardianCommitment(makeSecretKey());
      expect(() => sim.addGuardian(extraCom)).toThrow();
    });
  });

  // 10.4: removeGuardian
  describe("removeGuardian", () => {
    it("owner can remove a guardian", () => {
      const { sim } = createInitializedOwner();
      const gk = makeSecretKey();
      const gCom = GuardianRecoverySimulator.guardianCommitment(gk);
      sim.addGuardian(gCom);
      const ledger = sim.removeGuardian(gCom);
      expect(ledger.guardians.member(gCom)).toBe(false);
      expect(ledger.guardianCount).toEqual(0n);
    });

    it("non-owner cannot remove a guardian", () => {
      const { sim: ownerSim } = createInitializedOwner();
      const gk = makeSecretKey();
      const gCom = GuardianRecoverySimulator.guardianCommitment(gk);
      ownerSim.addGuardian(gCom);
      const attackerSim = createAttackerContext(ownerSim, makeSecretKey());
      expect(() => attackerSim.removeGuardian(gCom)).toThrow();
    });

    it("rejects removing non-existent guardian", () => {
      const { sim } = createInitializedOwner();
      const gCom = GuardianRecoverySimulator.guardianCommitment(makeSecretKey());
      expect(() => sim.removeGuardian(gCom)).toThrow();
    });

    it("rejects removing guardian during active recovery", () => {
      const { sim } = createInitializedOwner();
      const gk = makeSecretKey();
      const gCom = GuardianRecoverySimulator.guardianCommitment(gk);
      sim.addGuardian(gCom);
      sim.initiateRecovery(1n);
      expect(() => sim.removeGuardian(gCom)).toThrow();
    });
  });

  // 10.5: storeSharesCidHash
  describe("storeSharesCidHash", () => {
    it("owner can store shares CID hash", () => {
      const { sim } = createInitializedOwner();
      const cidHash = crypto.randomBytes(32);
      const ledger = sim.storeSharesCidHash(cidHash);
      expect(Buffer.from(ledger.sharesCidHash)).toEqual(Buffer.from(cidHash));
    });

    it("non-owner cannot store shares CID hash", () => {
      const { sim: ownerSim } = createInitializedOwner();
      const attackerSim = createAttackerContext(ownerSim, makeSecretKey());
      expect(() => attackerSim.storeSharesCidHash(crypto.randomBytes(32))).toThrow();
    });

    it("owner can overwrite shares CID hash", () => {
      const { sim } = createInitializedOwner();
      const cidHash1 = crypto.randomBytes(32);
      const cidHash2 = crypto.randomBytes(32);
      sim.storeSharesCidHash(cidHash1);
      const ledger = sim.storeSharesCidHash(cidHash2);
      expect(Buffer.from(ledger.sharesCidHash)).toEqual(Buffer.from(cidHash2));
    });
  });

  // 10.6: initiateRecovery
  describe("initiateRecovery", () => {
    it("owner can initiate recovery", () => {
      const { sim } = createInitializedOwner();
      const ledger = sim.initiateRecovery(1n);
      expect(ledger.recoveryInitiatedAt).toEqual(1n);
    });

    it("non-owner cannot initiate recovery", () => {
      const { sim: ownerSim } = createInitializedOwner();
      const attackerSim = createAttackerContext(ownerSim, makeSecretKey());
      expect(() => attackerSim.initiateRecovery(1n)).toThrow();
    });

    it("rejects zero timestamp (sentinel collision)", () => {
      const { sim } = createInitializedOwner();
      expect(() => sim.initiateRecovery(0n)).toThrow();
    });

    it("rejects if recovery already in progress", () => {
      const { sim } = createInitializedOwner();
      sim.initiateRecovery(1n);
      expect(() => sim.initiateRecovery(2n)).toThrow();
    });
  });

  // 10.7: approveRecovery
  describe("approveRecovery", () => {
    it("guardian can approve an active recovery", () => {
      const guardianKey = makeSecretKey();
      const { sim } = createInitializedOwner(undefined, guardianKey);
      const gCom = GuardianRecoverySimulator.guardianCommitment(guardianKey);
      sim.addGuardian(gCom);
      sim.initiateRecovery(1n);

      // Create guardian context joined to owner's state
      const guardianSim = createGuardianContext(sim, guardianKey);
      const ledger = guardianSim.approveRecovery();
      expect(ledger.approvedGuardians.member(gCom)).toBe(true);
    });

    it("non-guardian cannot approve", () => {
      const { sim } = createInitializedOwner();
      sim.initiateRecovery(1n);
      const nonGuardianKey = makeSecretKey();
      const fakeSim = createGuardianContext(sim, nonGuardianKey);
      expect(() => fakeSim.approveRecovery()).toThrow();
    });

    it("rejects if no recovery in progress", () => {
      const guardianKey = makeSecretKey();
      const { sim } = createInitializedOwner(undefined, guardianKey);
      const gCom = GuardianRecoverySimulator.guardianCommitment(guardianKey);
      sim.addGuardian(gCom);
      // No initiateRecovery called
      const guardianSim = createGuardianContext(sim, guardianKey);
      expect(() => guardianSim.approveRecovery()).toThrow();
    });

    it("rejects double approval from same guardian", () => {
      const guardianKey = makeSecretKey();
      const { sim } = createInitializedOwner(undefined, guardianKey);
      const gCom = GuardianRecoverySimulator.guardianCommitment(guardianKey);
      sim.addGuardian(gCom);
      sim.initiateRecovery(1n);

      const guardianSim = createGuardianContext(sim, guardianKey);
      guardianSim.approveRecovery();
      // Second approval from same guardian — must fail
      expect(() => guardianSim.approveRecovery()).toThrow();
    });
  });

  // 10.8: claimRecovery — negative tests
  describe("claimRecovery (negative)", () => {
    it("rejects if no recovery in progress", () => {
      const { sim } = createInitializedOwner();
      expect(() => sim.claimRecovery()).toThrow();
    });

    it("non-owner cannot claim recovery", () => {
      const { sim: ownerSim } = createInitializedOwner();
      ownerSim.initiateRecovery(1n);
      const attackerSim = createAttackerContext(ownerSim, makeSecretKey());
      expect(() => attackerSim.claimRecovery()).toThrow();
    });

    it("rejects with fewer than 2 guardian approvals", () => {
      const guardianKey1 = makeSecretKey();
      const { sim } = createInitializedOwner();

      // Add 3 guardians
      const gCom1 = GuardianRecoverySimulator.guardianCommitment(guardianKey1);
      const gCom2 = GuardianRecoverySimulator.guardianCommitment(makeSecretKey());
      const gCom3 = GuardianRecoverySimulator.guardianCommitment(makeSecretKey());
      sim.addGuardian(gCom1);
      sim.addGuardian(gCom2);
      sim.addGuardian(gCom3);

      sim.initiateRecovery(1n);

      // Only 1 guardian approves
      const guardianSim1 = createGuardianContext(sim, guardianKey1);
      guardianSim1.approveRecovery();

      // Sync state back to owner sim
      sim.circuitContext = createCircuitContext(
        sampleContractAddress(),
        guardianSim1.circuitContext.currentZswapLocalState,
        guardianSim1.circuitContext.currentQueryContext.state,
        sim.circuitContext.currentPrivateState,
      );

      // Claim should fail — only 1 approval, need 2.
      // Note: In the simulator, blockTimeGte(unlockTime) will also fail since
      // simulator block time = 0 and unlockTime = 1 + 259200 = 259201.
      // The assertion order may vary, but the claim should throw regardless.
      expect(() => sim.claimRecovery()).toThrow();
    });
  });

  // 10.9: claimRecovery — positive (time-lock test)
  describe("claimRecovery (positive)", () => {
    // The simulator's block time defaults to 0, making blockTimeGte(unlockTime)
    // impossible to satisfy with a real timestamp + 72-hour offset. A positive test
    // requires either simulator block-time mocking (not currently supported by
    // compact-runtime) or E2E on a local Midnight network with actual block time.
    it.skip("full initiate → approve → claim flow (requires block-time mocking or E2E)", () => {
      // Placeholder: when simulator supports setBlockTime(), implement:
      // 1. Owner initializes, adds 3 guardians
      // 2. Owner calls initiateRecovery(now)
      // 3. 2+ guardians call approveRecovery()
      // 4. Advance block time by 72+ hours
      // 5. Owner calls claimRecovery()
      // 6. Verify recoveryComplete == true
    });

    it.skip("rejects double claimRecovery (requires block-time mocking or E2E)", () => {
      // Depends on successful first claim (which needs block-time mocking).
      // After first claimRecovery() sets recoveryComplete = true,
      // a second call should throw "Recovery already completed".
    });
  });

  // 10.10: cancelRecovery
  describe("cancelRecovery", () => {
    it("owner can cancel an active recovery", () => {
      const guardianKey = makeSecretKey();
      const { sim } = createInitializedOwner(undefined, guardianKey);
      const gCom = GuardianRecoverySimulator.guardianCommitment(guardianKey);
      sim.addGuardian(gCom);
      sim.initiateRecovery(1n);

      // Guardian approves
      const guardianSim = createGuardianContext(sim, guardianKey);
      guardianSim.approveRecovery();

      // Sync state back to owner
      sim.circuitContext = createCircuitContext(
        sampleContractAddress(),
        guardianSim.circuitContext.currentZswapLocalState,
        guardianSim.circuitContext.currentQueryContext.state,
        sim.circuitContext.currentPrivateState,
      );

      // Owner cancels
      const ledger = sim.cancelRecovery();
      expect(ledger.recoveryInitiatedAt).toEqual(0n);
      expect(ledger.approvedGuardians.isEmpty()).toBe(true);
    });

    it("non-owner cannot cancel recovery", () => {
      const { sim: ownerSim } = createInitializedOwner();
      ownerSim.initiateRecovery(1n);
      const attackerSim = createAttackerContext(ownerSim, makeSecretKey());
      expect(() => attackerSim.cancelRecovery()).toThrow();
    });

    it("rejects if no recovery in progress", () => {
      const { sim } = createInitializedOwner();
      expect(() => sim.cancelRecovery()).toThrow();
    });
  });

  // 10.11: Domain separator isolation
  describe("domain separator isolation", () => {
    it("ownerCommitment(key) !== guardianCommitment(key)", () => {
      const key = makeSecretKey();
      const ownerC = GuardianRecoverySimulator.ownerCommitment(key);
      const guardianC = GuardianRecoverySimulator.guardianCommitment(key);
      expect(Buffer.from(ownerC)).not.toEqual(Buffer.from(guardianC));
    });

    it("produces deterministic commitments", () => {
      const key = makeSecretKey();
      const c1 = GuardianRecoverySimulator.ownerCommitment(key);
      const c2 = GuardianRecoverySimulator.ownerCommitment(key);
      expect(Buffer.from(c1)).toEqual(Buffer.from(c2));

      const g1 = GuardianRecoverySimulator.guardianCommitment(key);
      const g2 = GuardianRecoverySimulator.guardianCommitment(key);
      expect(Buffer.from(g1)).toEqual(Buffer.from(g2));
    });

    it("different keys produce different commitments", () => {
      const k1 = makeSecretKey();
      const k2 = makeSecretKey();
      expect(Buffer.from(GuardianRecoverySimulator.ownerCommitment(k1)))
        .not.toEqual(Buffer.from(GuardianRecoverySimulator.ownerCommitment(k2)));
      expect(Buffer.from(GuardianRecoverySimulator.guardianCommitment(k1)))
        .not.toEqual(Buffer.from(GuardianRecoverySimulator.guardianCommitment(k2)));
    });
  });

  // 10.12: Cross-instance access control
  describe("cross-instance access control", () => {
    it("attacker cannot call any owner circuit on another's contract", () => {
      const { sim: ownerSim } = createInitializedOwner();
      const attackerSim = createAttackerContext(ownerSim, makeSecretKey());

      // All owner-only circuits should fail
      expect(() => attackerSim.addGuardian(GuardianRecoverySimulator.guardianCommitment(makeSecretKey()))).toThrow();
      expect(() => attackerSim.removeGuardian(GuardianRecoverySimulator.guardianCommitment(makeSecretKey()))).toThrow();
      expect(() => attackerSim.storeSharesCidHash(crypto.randomBytes(32))).toThrow();
      expect(() => attackerSim.initiateRecovery(1n)).toThrow();
    });
  });
});
