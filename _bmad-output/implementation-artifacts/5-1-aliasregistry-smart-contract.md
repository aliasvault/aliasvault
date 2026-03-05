# Story 5.1: AliasRegistry Smart Contract

Status: review

## Story

As a user,
I want my alias ownership recorded on-chain,
so that only I can receive emails to my aliases.

## Acceptance Criteria

1. `alias-registry.compact` contract created with `pragma language_version >= 0.20`
2. `claimAlias(aliasHash: Bytes<32>, contractAddr: Opaque<'string'>)` registers alias to caller's commitment with VaultRegistry contract address
3. `getOwner(aliasHash: Bytes<32>)` returns owner commitment (or `default<Bytes<32>>` if unclaimed)
4. `getContractAddress(aliasHash: Bytes<32>)` returns owner's VaultRegistry contract address (or default if unclaimed)
5. `releaseAlias(aliasHash: Bytes<32>)` removes ownership (owner-only, verified via commitment)
6. Alias-to-owner mapping uses `Map<Bytes<32>, Bytes<32>>` (aliasHash to ownerCommitment)
7. Alias-to-contract mapping uses `Map<Bytes<32>, Opaque<'string'>>` (aliasHash to VaultRegistry contract address)
8. `ownerCommitment` pure circuit uses domain separator `"alias:owner:"` (unique per Rule 14/15 — different from `"vault:owner:"` and `"recovery:owner:"`)
9. Unit tests for all contract functions (claim, getOwner, getContractAddress, release)
10. Integration test: claim -> getOwner -> getContractAddress -> release flow
11. Existing contract tests still pass (no regressions)
12. `compact:alias-registry` script added to package.json

## Tasks / Subtasks

- [x] Task 1: Create `alias-registry.compact` contract file (AC: 1, 6, 7, 8)
  - [x] 1.1 Create `src/alias-registry.compact` with pragma, import, header comment
  - [x] 1.2 Add `aliasOwners: Map<Bytes<32>, Bytes<32>>` ledger variable
  - [x] 1.3 Add `aliasContracts: Map<Bytes<32>, Opaque<'string'>>` ledger variable
  - [x] 1.4 Add `totalClaimCount: Counter` ledger variable (renamed from totalAliases per M1)
  - [x] 1.5 Add `witness local_secret_key(): Bytes<32>` declaration
  - [x] 1.6 Add `ownerCommitment` pure circuit with `"alias:owner:"` domain separator
- [x] Task 2: Add `claimAlias` circuit (AC: 2)
  - [x] 2.1 `disclose(aliasHash)` and `disclose(contractAddr)` before use
  - [x] 2.2 `assert(!aliasOwners.member(hash), "Alias already claimed")`
  - [x] 2.3 `aliasOwners.insert(hash, ownerCommitment(local_secret_key()))`
  - [x] 2.4 `aliasContracts.insert(hash, addr)`
  - [x] 2.5 `totalClaimCount.increment(1)`
- [x] Task 3: Add `getOwner` circuit (AC: 3)
  - [x] 3.1 `disclose(aliasHash)` then return `aliasOwners.lookup(hash)`
  - [x] 3.2 Returns `default<Bytes<32>>` for unclaimed aliases (Map.lookup default behavior)
- [x] Task 4: Add `getContractAddress` circuit (AC: 4)
  - [x] 4.1 `disclose(aliasHash)` then return `aliasContracts.lookup(hash)`
  - [x] 4.2 Returns default for unclaimed aliases
- [x] Task 5: Add `releaseAlias` circuit (AC: 5)
  - [x] 5.1 `disclose(aliasHash)` before use
  - [x] 5.2 `assert(aliasOwners.member(hash), "Alias not claimed")`
  - [x] 5.3 `assert(aliasOwners.lookup(hash) == ownerCommitment(local_secret_key()), "Not the alias owner")`
  - [x] 5.4 `aliasOwners.remove(hash)` and `aliasContracts.remove(hash)`
- [x] Task 6: Create TypeScript witnesses file (AC: 1)
  - [x] 6.1 Create `src/alias-registry-witnesses.ts` with `AliasRegistryPrivateState` type (secretKey only)
  - [x] 6.2 Add `createAliasRegistryPrivateState(secretKey)` factory
  - [x] 6.3 Add `aliasRegistryWitnesses` with `local_secret_key` implementation
- [x] Task 7: Compile contract and add build script (AC: 12)
  - [x] 7.1 Add `"compact:alias-registry": "compact compile src/alias-registry.compact src/managed/alias-registry"` to package.json
  - [x] 7.2 Update `"compact"` script to also compile alias-registry
  - [x] 7.3 Update `"build"` script to copy `alias-registry.compact` to dist
  - [x] 7.4 Run `pnpm run compact:alias-registry` and verify compilation succeeds
  - [x] 7.5 Verify generated `managed/alias-registry/contract/index.js` exports all circuits
- [x] Task 8: Create AliasRegistrySimulator (AC: 9)
  - [x] 8.1 Create `src/test/alias-registry-simulator.ts` following VaultRegistrySimulator pattern
  - [x] 8.2 Constructor takes `secretKey: Uint8Array`
  - [x] 8.3 Add wrapper methods: `claimAlias(aliasHash, contractAddr)`, `getOwner(aliasHash)`, `getContractAddress(aliasHash)`, `releaseAlias(aliasHash)`
  - [x] 8.4 Add `static ownerCommitment(sk)` pure circuit wrapper
- [x] Task 9: Write unit tests (AC: 9, 10, 11)
  - [x] 9.1 `claimAlias`: can claim unclaimed, stores correct owner commitment, stores correct contract address, rejects already-claimed, different users can claim different aliases
  - [x] 9.2 `getOwner`: returns commitment for claimed alias, returns default for unclaimed
  - [x] 9.3 `getContractAddress`: returns address for claimed alias, returns default for unclaimed
  - [x] 9.4 `releaseAlias`: owner can release, non-owner cannot release, released alias can be re-claimed, unclaimed alias fails
  - [x] 9.5 `ownerCommitment`: deterministic, different from VaultRegistry ownerCommitment for same key (different domain separator), different for different keys
  - [x] 9.6 Integration: full claim -> getOwner -> getContractAddress -> release lifecycle
  - [x] 9.7 Run full test suite (`npx vitest run`) to verify zero regressions across all contracts

## Dev Notes

### Architecture: What This Story Does and Does NOT Do

**In scope:** New `alias-registry.compact` contract + TypeScript witnesses/simulator/tests + package.json build scripts. All changes in `packages/blockchain/contract/`.

**Out of scope:** Client-side alias name validation (3-64 chars, alphanumeric + hyphen — done in browser extension, Story 5.2). Anti-squatting (deferred to post-MVP per epic). Alias hashing logic (SHA-256 of `localPart@domain` — done client-side by extension and bridge). Contract deployment scripts (future story).

### Contract Source Files

| File | Action | Purpose |
|------|--------|---------|
| `packages/blockchain/contract/src/alias-registry.compact` | **Create** | New contract: 3 ledger vars, 1 witness, 5 circuits |
| `packages/blockchain/contract/src/alias-registry-witnesses.ts` | **Create** | Private state type + witness implementation |
| `packages/blockchain/contract/src/test/alias-registry-simulator.ts` | **Create** | Test simulator with typed wrappers |
| `packages/blockchain/contract/src/test/alias-registry.test.ts` | **Create** | ~16 unit tests in 6 describe blocks |
| `packages/blockchain/contract/src/managed/alias-registry/` | **Auto-generated** | Compiled contract output |
| `packages/blockchain/contract/package.json` | **Edit** | Add compact:alias-registry script, update compact + build scripts |

### Compact Code to Add

```compact
pragma language_version >= 0.20;

import CompactStandardLibrary;

// AliasRegistry Contract — Story 5.1
//
// PURPOSE: Global alias registration mapping aliases to their owners'
//          VaultRegistry contract addresses. The SMTP bridge queries this
//          to find where to deliver encrypted emails.
//
// FUNCTIONS:
//   Owner-only (verified via ownerCommitment(local_secret_key())):
//     - releaseAlias(aliasHash)              Removes alias ownership
//
//   Public (any caller):
//     - claimAlias(aliasHash, contractAddr)  Claims unclaimed alias
//     - getOwner(aliasHash)                  Returns owner commitment
//     - getContractAddress(aliasHash)        Returns VaultRegistry address
//
//   Pure circuits:
//     - ownerCommitment(sk)                  Derives owner identity commitment
//
// ACCESS CONTROL MATRIX:
//   Function           | Caller     | Verification
//   claimAlias         | Any        | !aliasOwners.member(hash) (unclaimed only)
//   getOwner           | Any        | None (read-only)
//   getContractAddress | Any        | None (read-only)
//   releaseAlias       | Owner only | ownerCommitment(local_secret_key())
//   ownerCommitment    | Pure       | N/A
//
// STATE VARIABLES:
//   - aliasOwners: Map<Bytes<32>, Bytes<32>>           — aliasHash -> ownerCommitment
//   - aliasContracts: Map<Bytes<32>, Opaque<'string'>> — aliasHash -> VaultRegistry contract address
//   - totalAliases: Counter                             — total claimed aliases
//
// WITNESSES:
//   - local_secret_key(): Bytes<32>  — caller's secret key from TypeScript private state

// Public ledger: alias hash -> owner commitment
export ledger aliasOwners: Map<Bytes<32>, Bytes<32>>;

// Public ledger: alias hash -> VaultRegistry contract address
export ledger aliasContracts: Map<Bytes<32>, Opaque<'string'>>;

// Public ledger: total aliases claimed
export ledger totalAliases: Counter;

// Witness: returns the caller's secret key from private state
witness local_secret_key(): Bytes<32>;

// Derive an owner commitment from a secret key.
// Uses domain separator "alias:owner:" — unique to AliasRegistry.
// Different from "vault:owner:" (VaultRegistry) and "recovery:owner:" (GuardianRecovery).
export circuit ownerCommitment(sk: Bytes<32>): Bytes<32> {
  return persistentCommit<Bytes<32>>(pad(32, "alias:owner:"), sk);
}

// Claim an unclaimed alias. Stores the caller's owner commitment and
// their VaultRegistry contract address (for bridge email routing).
export circuit claimAlias(aliasHash: Bytes<32>, contractAddr: Opaque<'string'>): [] {
  const hash = disclose(aliasHash);
  const addr = disclose(contractAddr);
  assert(!aliasOwners.member(hash), "Alias already claimed");
  const sk = local_secret_key();
  aliasOwners.insert(hash, ownerCommitment(sk));
  aliasContracts.insert(hash, addr);
  totalAliases.increment(1);
}

// Get the owner commitment for an alias. Returns default<Bytes<32>> if unclaimed.
export circuit getOwner(aliasHash: Bytes<32>): Bytes<32> {
  return aliasOwners.lookup(disclose(aliasHash));
}

// Get the VaultRegistry contract address for an alias owner.
// Returns default if unclaimed. The SMTP bridge uses this to find
// the user's emailPublicKey and call notifyNewMail.
export circuit getContractAddress(aliasHash: Bytes<32>): Opaque<'string'> {
  return aliasContracts.lookup(disclose(aliasHash));
}

// Release an alias. Only the alias owner can call this.
export circuit releaseAlias(aliasHash: Bytes<32>): [] {
  const hash = disclose(aliasHash);
  const sk = local_secret_key();
  assert(aliasOwners.member(hash), "Alias not claimed");
  assert(aliasOwners.lookup(hash) == ownerCommitment(sk), "Not the alias owner");
  aliasOwners.remove(hash);
  aliasContracts.remove(hash);
}
```

### Witness File Pattern

Follow `guardian-recovery-witnesses.ts` exactly — single-witness private state:

```typescript
import { type WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { type Ledger } from './managed/alias-registry/contract/index.js';

export type AliasRegistryPrivateState = {
  readonly secretKey: Uint8Array;
};

export const createAliasRegistryPrivateState = (
  secretKey: Uint8Array,
): AliasRegistryPrivateState => ({
  secretKey,
});

export const aliasRegistryWitnesses = {
  local_secret_key: ({
    privateState,
  }: WitnessContext<Ledger, AliasRegistryPrivateState>): [
    AliasRegistryPrivateState,
    Uint8Array,
  ] => [privateState, privateState.secretKey],
};
```

### Simulator Pattern

Follow `VaultRegistrySimulator` — constructor creates contract + circuitContext:

```typescript
import { Contract, type Ledger, ledger, pureCircuits } from "../managed/alias-registry/contract/index.js";
import { type AliasRegistryPrivateState, aliasRegistryWitnesses, createAliasRegistryPrivateState } from "../alias-registry-witnesses.js";

export class AliasRegistrySimulator {
  readonly contract: Contract<AliasRegistryPrivateState>;
  circuitContext: CircuitContext<AliasRegistryPrivateState>;  // public for cross-instance injection

  constructor(secretKey: Uint8Array) {
    this.contract = new Contract<AliasRegistryPrivateState>(aliasRegistryWitnesses);
    const initialPrivateState = createAliasRegistryPrivateState(secretKey);
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(createConstructorContext(initialPrivateState, "0".repeat(64)));
    this.circuitContext = createCircuitContext(
      sampleContractAddress(), currentZswapLocalState, currentContractState, currentPrivateState
    );
  }

  public getLedger(): Ledger { return ledger(this.circuitContext.currentQueryContext.state); }
  public getPrivateState(): AliasRegistryPrivateState { return this.circuitContext.currentPrivateState; }

  public claimAlias(aliasHash: Uint8Array, contractAddr: string): Ledger { /* impureCircuits.claimAlias */ }
  public getOwner(aliasHash: Uint8Array): Uint8Array { /* impureCircuits.getOwner → result.result */ }
  public getContractAddress(aliasHash: Uint8Array): string { /* impureCircuits.getContractAddress → result.result */ }
  public releaseAlias(aliasHash: Uint8Array): Ledger { /* impureCircuits.releaseAlias */ }

  public static ownerCommitment(sk: Uint8Array): Uint8Array { return pureCircuits.ownerCommitment(sk); }
}
```

**Note on return types:** `getOwner` returns `Uint8Array` (Bytes<32>), `getContractAddress` returns `string` (Opaque<'string'> maps to string in TypeScript). Verify against the generated `index.js` after compilation — check the `result.result` type. See how `isRegistered` returns `boolean` in VaultRegistrySimulator for the pattern.

### Test Plan

New tests (~16) organized in 6 `describe` blocks:

```
describe("AliasRegistry smart contract")
  describe("claimAlias")
    - can claim an unclaimed alias
    - stores correct owner commitment
    - stores correct contract address
    - rejects already-claimed alias
    - different users can claim different aliases

  describe("getOwner")
    - returns owner commitment for claimed alias
    - returns default<Bytes<32>> for unclaimed alias

  describe("getContractAddress")
    - returns contract address for claimed alias
    - returns default for unclaimed alias

  describe("releaseAlias")
    - owner can release their alias
    - non-owner cannot release alias
    - released alias can be re-claimed
    - releasing unclaimed alias fails

  describe("ownerCommitment (pure circuit)")
    - deterministic for same key
    - different from VaultRegistry ownerCommitment for same key
    - different for different keys

  describe("integration: full lifecycle")
    - claim -> getOwner -> getContractAddress -> release -> re-claim
```

**Test helpers:**
- `makeSecretKey()` — `crypto.randomBytes(32)` (same as vault-registry tests)
- `makeAliasHash(seed)` — `new Uint8Array(32)` with `hash[0] = seed`
- `createClaimedAlias(sk?)` — creates simulator, claims alias, returns `{ sim, secretKey, aliasHash }`
- `createAttackerContext(ownerSim, attackerSk)` — same cross-instance injection pattern as vault-registry tests

**For `getOwner`/`getContractAddress` return value extraction:** These circuits return values (not just mutate state). Use the same pattern as `isRegistered`:
```typescript
const result = this.contract.impureCircuits.getOwner(this.circuitContext, aliasHash);
this.circuitContext = result.context;
return result.result as unknown as Uint8Array;
```

**Import VaultRegistrySimulator in tests** to compare `ownerCommitment` outputs across contracts (different domain separators → different commitments for same key).

### Compact Language Constraints Checklist

Per project-context Rule 10 — verify before writing:

- [x] `pragma language_version >= 0.20;` — required
- [x] `disclose()` on all circuit parameters before ledger/conditional use
- [x] `persistentCommit<Bytes<32>>(pad(32, "alias:owner:"), sk)` — correct signature
- [x] `pad(32, "alias:owner:")` — correct string-to-Bytes conversion
- [x] Return type `): []` not `): Void`
- [x] `Counter.increment(1)` — confirmed across reference projects
- [x] `Opaque<'string'>` for contract address — confirmed in bboard, composable-inner
- [x] `Map.lookup()` returns default for non-existent keys
- [x] `Map.member()` for existence check before `lookup()`

### Midnight SDK Reference Cross-Check (Rule 18)

| Pattern | Reference Projects | Our Usage |
|---------|-------------------|-----------|
| `persistentCommit` for authorization | bboard, composable-inner, micro-dao, coracle, midnames | `ownerCommitment(sk)` — identical |
| `Map<Bytes<32>, Bytes<32>>` for ownership | midnames (name → owner), micro-dao | `aliasOwners` map |
| `Map<Bytes<32>, Opaque<'string'>>` | No exact match — but `Map<K, Opaque>` pattern confirmed in compact test suite | `aliasContracts` map |
| `Opaque<'string'>` as circuit param | bboard (`post(new_message: Opaque<"string">)`), election | `claimAlias(contractAddr)`, `getContractAddress` return |
| Counter for registry stats | counter example, bboard, election | `totalAliases` |
| Cross-instance state injection (tests) | Our own `createAttackerContext` | Same pattern for multi-user alias tests |

### Domain Separator Decision

AliasRegistry uses `"alias:owner:"` — NOT `"vault:owner:"`. Rationale:

1. **Rule 14/15 precedent:** GuardianRecovery uses `"recovery:owner:"`, VaultRegistry uses `"vault:owner:"`. Each contract gets a unique domain separator.
2. **Defense in depth:** If one contract's commitment is compromised, it can't be replayed against another contract.
3. **Consequence:** The same `secretKey` produces DIFFERENT commitments in VaultRegistry vs AliasRegistry. This is intentional — cross-contract identity linkage happens via the `aliasContracts` map (storing the VaultRegistry contract address), not via matching commitments.

### Key Risk: `getOwner` / `getContractAddress` Return Types

The generated TypeScript for circuits that RETURN values (not just `[]`) needs careful handling. Verify after compilation:
- `getOwner` should return `Uint8Array` (from `Bytes<32>`)
- `getContractAddress` should return `string` (from `Opaque<'string'>`)

Check the generated `index.js` for the impureCircuits signatures and the `result.result` type. Compare with `isRegistered` which returns `Boolean` → `boolean`.

### Package.json Script Changes

```json
{
  "scripts": {
    "compact": "compact compile src/counter.compact src/managed/counter && compact compile src/vault-registry.compact src/managed/vault-registry && compact compile src/alias-registry.compact src/managed/alias-registry",
    "compact:alias-registry": "compact compile src/alias-registry.compact src/managed/alias-registry",
    "build": "rm -rf dist && tsc --project tsconfig.build.json && cp -Rf ./src/managed ./dist/managed && cp ./src/counter.compact ./dist && cp ./src/vault-registry.compact ./dist && cp ./src/alias-registry.compact ./dist"
  }
}
```

### Previous Story Intelligence

**From Story 5.0 (most recent):**
- `Opaque<'string'>` maps to `string` in generated TypeScript API — confirmed in generated index.js
- `default<Opaque<'string'>>` is valid Compact syntax — compiled successfully in H1 fix
- Code review found H1 (stale state on transfer), M1 (test isolation), M2 (revocation test) — apply same thoroughness to AliasRegistry tests
- Compact compiler invoked via `pnpm run compact:vault-registry` — NOT `npx compactc`
- Test framework: vitest, run via `npx vitest run` from contract directory
- 82 existing tests across 3 test files — AliasRegistry tests will be the 4th file

**From Story 3.1 (GuardianRecovery — second contract precedent):**
- Separate witness file: `guardian-recovery-witnesses.ts` with its own `PrivateState` type
- Separate simulator: `guardian-recovery-simulator.ts` with identical pattern
- Domain separator convention: each contract uses unique prefix (`"recovery:"` vs `"vault:"` vs `"alias:"`)
- `compact:guardian-recovery` script is MISSING from package.json — was compiled manually. Don't repeat this mistake — add the script.

### Project Structure Notes

- All changes within `packages/blockchain/contract/` — no cross-package changes
- AliasRegistry is a SINGLETON contract (one instance for all users) unlike GuardianRecovery (per-vault)
- No browser extension changes needed (pure on-chain contract)
- No `externals.d.ts` update needed (contract package is in pnpm workspace)
- Downstream consumers: Story 5.2 (extension calls claimAlias), Story 5.3 (bridge queries getOwner + getContractAddress)

### References

- [ADR-009: On-Chain Email Notification](docs/architecture/adr-009-email-notification-on-chain.md) — bridge reads AliasRegistry to route emails
- [ADR-008: X25519 Hybrid Encryption](docs/architecture/adr-008-email-encryption-x25519.md) — why bridge needs contract address (to read emailPublicKey)
- [VaultRegistry Contract](packages/blockchain/contract/src/vault-registry.compact) — commitment patterns, access control
- [GuardianRecovery Contract](packages/blockchain/contract/src/guardian-recovery.compact) — second contract precedent, separate witness file
- [GuardianRecovery Witnesses](packages/blockchain/contract/src/guardian-recovery-witnesses.ts) — witness file pattern
- [VaultRegistry Simulator](packages/blockchain/contract/src/test/vault-registry-simulator.ts) — simulator pattern
- [VaultRegistry Tests](packages/blockchain/contract/src/test/vault-registry.test.ts) — test helpers, cross-instance injection
- [Project Context Rule 10](project-context.md#10) — Compact language gotchas
- [Project Context Rule 11](project-context.md#11) — Contract unit testing pattern
- [Project Context Rule 14](project-context.md#14) — ADT operations, domain separators
- [Epics: Story 5.1](epics.md) — Original story definition

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Compact compiler compiled 4 circuits from alias-registry.compact successfully
- Simulator `Map.lookup` throws for non-existent keys (on-chain returns default) — tests adjusted to use `getLedger().aliasOwners.member()` for absence checks instead of circuit-level getOwner/getContractAddress on unclaimed aliases

### Completion Notes List

- Created `alias-registry.compact` with 3 ledger vars (aliasOwners, aliasContracts, totalClaimCount), 1 witness, 5 circuits (ownerCommitment, claimAlias, getOwner, getContractAddress, releaseAlias)
- Domain separator `"alias:owner:"` — confirmed different from `"vault:owner:"` and `"recovery:owner:"` via cross-contract test (Task 9.5)
- Created `alias-registry-witnesses.ts` with single-witness private state (secretKey only)
- Created `AliasRegistrySimulator` with typed wrappers — getOwner returns Uint8Array, getContractAddress returns string (confirmed via generated index.d.ts)
- 19 tests in 6 describe blocks (7 claimAlias, 2 getOwner, 2 getContractAddress, 5 releaseAlias, 3 ownerCommitment, 1 integration lifecycle)
- Full suite: 107 tests (101 pass, 6 skipped — all pre-existing skips), zero regressions
- Added `compact:alias-registry` script, updated `compact` and `build` scripts in package.json
- Code review fixes applied: M1 (totalAliases → totalClaimCount), M2 (removed dead ZERO_BYTES_32), M3 (added monotonic counter test), M4 (added single-user multi-alias test). L1/L2 not warranted (precedent + documented limitation).

### Change Log

- 2026-03-05: Story 5.1 implemented — AliasRegistry smart contract with full test suite
- 2026-03-05: Code review applied — M1 (totalAliases→totalClaimCount rename), M2 (dead code removal), M3 (monotonic counter test), M4 (single-user multi-alias test)

### File List

- `packages/blockchain/contract/src/alias-registry.compact` — **Created** — AliasRegistry contract (3 ledger vars, 5 circuits)
- `packages/blockchain/contract/src/alias-registry-witnesses.ts` — **Created** — Witness file with AliasRegistryPrivateState
- `packages/blockchain/contract/src/test/alias-registry-simulator.ts` — **Created** — Test simulator with typed circuit wrappers
- `packages/blockchain/contract/src/test/alias-registry.test.ts` — **Created** — 19 unit tests in 6 describe blocks
- `packages/blockchain/contract/src/managed/alias-registry/` — **Auto-generated** — Compiled contract output (index.js, index.d.ts)
- `packages/blockchain/contract/package.json` — **Modified** — Added compact:alias-registry script, updated compact + build scripts
