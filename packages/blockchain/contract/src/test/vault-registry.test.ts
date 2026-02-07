import { VaultRegistrySimulator } from "./vault-registry-simulator.js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { describe, it, expect } from "vitest";

setNetworkId("undeployed");

describe("VaultRegistry smart contract", () => {
  it("generates initial ledger state deterministically", () => {
    const simulator0 = new VaultRegistrySimulator();
    const simulator1 = new VaultRegistrySimulator();
    expect(simulator0.getLedger().totalVaults).toEqual(simulator1.getLedger().totalVaults);
  });

  it("properly initializes ledger state with zero vaults", () => {
    const simulator = new VaultRegistrySimulator();
    const initialLedger = simulator.getLedger();
    expect(initialLedger.totalVaults).toEqual(0n);
  });

  it("registers a vault and increments totalVaults", () => {
    const simulator = new VaultRegistrySimulator();
    const hash = new Uint8Array(32);
    hash[0] = 0x01;

    const ledgerAfter = simulator.registerVault(hash);
    expect(ledgerAfter.totalVaults).toEqual(1n);
  });

  it("rejects duplicate vault registration", () => {
    const simulator = new VaultRegistrySimulator();
    const hash = new Uint8Array(32);
    hash[0] = 0x42;

    simulator.registerVault(hash);

    expect(() => simulator.registerVault(hash)).toThrow();
  });

  it("allows registering different vaults", () => {
    const simulator = new VaultRegistrySimulator();
    const hash1 = new Uint8Array(32);
    hash1[0] = 0x01;
    const hash2 = new Uint8Array(32);
    hash2[0] = 0x02;

    simulator.registerVault(hash1);
    const ledgerAfter = simulator.registerVault(hash2);
    expect(ledgerAfter.totalVaults).toEqual(2n);
  });
});
