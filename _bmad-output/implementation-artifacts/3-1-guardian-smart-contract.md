# Story 3.1: Guardian Smart Contract

Status: done

## Story

As a user,
I want a smart contract to manage my recovery guardians with a 72-hour time-lock,
so that I can safely recover my account if I lose my master password.

## Acceptance Criteria

1. `GuardianRecovery.compact` contract scaffolded with spec header and access control matrix
2. `addGuardian(guardianCommitment)` stores guardian commitment hashes (owner-only, up to 3)
3. `initiateRecovery(currentTime)` starts 72h timer with on-chain `blockTimeGte()` enforcement
4. `claimRecovery()` fails before 72h or with < 2 approvals, succeeds after both conditions met
5. `cancelRecovery()` for owner to cancel malicious recovery attempts
6. Unit tests for timer logic, access control, guardian approval threshold, and edge cases

## Tasks / Subtasks

- [x] Task 1: Contract scaffold (AC: #1)
  - [x] 1.1 Create `packages/blockchain/contract/src/guardian-recovery.compact` with spec header
  - [x] 1.2 Define ledger fields: `owner`, `guardians`, `guardianCount`, `recoveryInitiatedAt`, `approvedGuardians`, `sharesCidHash`, `recoveryComplete`
  - [x] 1.3 Define witnesses: `local_secret_key()`, `local_guardian_key()`
  - [x] 1.4 Define exported pure circuits: `ownerCommitment(sk)`, `guardianCommitment(gk)` with unique domain separators
  - [x] 1.5 Add `initialize(ownerCommitment)` circuit for contract setup — reject if already initialized (`owner != default<Bytes<32>>`)
- [x] Task 2: Guardian registration circuits (AC: #2)
  - [x] 2.1 Implement `addGuardian(guardianCommitment)` — owner-only, reject duplicate (`!guardians.member()`), inserts to `guardians` set, increments `guardianCount`
  - [x] 2.2 Implement `removeGuardian(guardianCommitment)` — owner-only, reject if not a member (`guardians.member()`), removes from `guardians` set, decrements `guardianCount`
  - [x] 2.3 Add guard: reject if `guardianCount` already at 3 (for `addGuardian`)
  - [x] 2.4 Implement `storeSharesCidHash(cidHash)` — owner-only, stores hash of IPFS CID containing encrypted shares
- [x] Task 3: Recovery initiation circuit (AC: #3)
  - [x] 3.1 Implement `initiateRecovery(currentTime)` — owner-only, sets `recoveryInitiatedAt`
  - [x] 3.2 Add sentinel guard: reject `currentTime == 0` (0 is "no recovery" sentinel)
  - [x] 3.3 Add guard: reject if recovery already in progress (`recoveryInitiatedAt != 0`)
  - [x] 3.4 Add `blockTimeGte(currentTime)` check to reject future timestamps
- [x] Task 4: Guardian approval circuit (AC: #4)
  - [x] 4.1 Implement `approveRecovery()` — guardian-only via `guardianCommitment(local_guardian_key())` + `guardians.member()`
  - [x] 4.2 Add guard: reject if no recovery in progress
  - [x] 4.3 Add guard: reject if guardian already approved (via `approvedGuardians.member()`)
  - [x] 4.4 Insert guardian commitment to `approvedGuardians` set on success
- [x] Task 5: Recovery completion circuit (AC: #4)
  - [x] 5.1 Implement `claimRecovery()` — owner-only, reject if no recovery active (`recoveryInitiatedAt != 0`), verifies 72h time-lock via `blockTimeGte(unlockTime)`
  - [x] 5.2 Add threshold check: `approvedGuardians.size() >= 2`
  - [x] 5.3 Set `recoveryComplete = true` on success
  - [x] 5.4 Implement `Uint<64>` arithmetic for unlock time: `(((recoveryInitiatedAt as Field) + (259200 as Field)) as Uint<64>)`
- [x] Task 6: Recovery cancellation circuit (AC: #5)
  - [x] 6.1 Implement `cancelRecovery()` — owner-only, reject if no recovery active (`recoveryInitiatedAt == 0`), resets `recoveryInitiatedAt` to 0
  - [x] 6.2 Call `approvedGuardians.resetToDefault()` in `cancelRecovery()` to clear all stale approvals
- [x] Task 7: TypeScript private state & witnesses (AC: #1)
  - [x] 7.1 Create `GuardianRecoveryPrivateState` type in new `guardian-recovery-witnesses.ts` (or extend `witnesses.ts`)
  - [x] 7.2 Define `guardianRecoveryWitnesses` with `local_secret_key` and `local_guardian_key` mappings
  - [x] 7.3 Create `createGuardianRecoveryPrivateState(secretKey, guardianKey?)` factory
- [x] Task 8: Compile contract (AC: #1)
  - [x] 8.1 Run `compact compile src/guardian-recovery.compact src/managed/guardian-recovery`
  - [x] 8.2 Verify compilation succeeds, note circuit sizes (k values, row counts)
  - [x] 8.3 Export from `index.ts`
- [x] Task 9: Simulator (AC: #6)
  - [x] 9.1 Create `guardian-recovery-simulator.ts` following VaultRegistry simulator pattern
  - [x] 9.2 Add typed methods for all circuits
  - [x] 9.3 Expose `getLedger()`, `getPrivateState()`, `circuitContext` (public for cross-instance testing)
  - [x] 9.4 Add static methods for pure circuits: `ownerCommitment()`, `guardianCommitment()`
- [x] Task 10: Unit tests (AC: #6)
  - [x] 10.1 Test initial ledger state (all defaults)
  - [x] 10.2 Test `initialize` — sets owner, rejects double-init
  - [x] 10.3 Test `addGuardian` — owner-only, rejects non-owner, rejects duplicate, rejects > 3
  - [x] 10.4 Test `removeGuardian` — owner-only, rejects non-guardian
  - [x] 10.5 Test `storeSharesCidHash` — owner-only
  - [x] 10.6 Test `initiateRecovery` — owner-only, rejects zero timestamp, rejects if already active
  - [x] 10.7 Test `approveRecovery` — guardian-only, rejects non-guardian, rejects if no recovery, rejects double approval
  - [x] 10.8 Test `claimRecovery` — owner-only, rejects if no recovery, rejects if < 2 approvals
  - [x] 10.9 Test `claimRecovery` time-lock — `it.skip` with note about simulator block-time limitation (same as Story 2.6 H3)
  - [x] 10.10 Test `cancelRecovery` — owner-only, rejects if no recovery active
  - [x] 10.11 Test `guardianCommitment` isolation — verify `ownerCommitment(key) !== guardianCommitment(key)` (domain separator)
  - [x] 10.12 Test cross-instance access control — attacker's private state injected into owner's circuitContext
- [x] Task 11: CLI API layer (AC: #1)
  - [x] 11.1 Create `guardian-recovery-api.ts` with deploy, join, and circuit wrapper functions
  - [x] 11.2 Create `getGuardianRecoveryLedgerState()` returning all ledger fields
  - [x] 11.3 Add unit tests in `guardian-recovery-api.test.ts`
- [x] Task 12: Documentation (AC: #1)
  - [x] 12.1 Create `GUARDIAN-RECOVERY-SPEC.md` canonical specification (following VAULT-REGISTRY-SPEC.md pattern)
  - [x] 12.2 Update `packages/blockchain/README.md` with GuardianRecovery section
  - [x] 12.3 Add contract header with spec, access control matrix, and Compact constraints

## Dev Notes

### Architecture Constraints (CRITICAL)

**This is a NEW Compact contract, separate from VaultRegistry.** Follow the exact same patterns established in Stories 2.1 and 2.6.

**Architecture pseudocode is NOT Compact syntax.** The architecture document (`architecture.md` section 4) uses `this.sender`, `this.public`, `this.private`, `require()`, `currentTimestamp()` — NONE of these exist in Compact. Translate to:
- `this.sender` → witness + `persistentCommit` pattern
- `require()` → `assert(condition, "message")`
- `currentTimestamp()` → `blockTimeGte(time: Uint<64>)` where time is passed as circuit parameter
- `this.public.X` / `this.private.X` → `export ledger X` (public) / TypeScript `PrivateState` (private)

**Architecture says GuardianRecovery uses `Map<WalletAddress, RecoveryRequest>` and `struct` types.** Compact DOES support `Map<K,V>` and `struct`. However, this story uses a per-vault flat-field design (single-owner, like VaultRegistry) for simplicity. A shared contract model with `Map` keyed by owner commitment is feasible but deferred — revisit in a future story if multi-vault support is needed.

### Contract Design

**Deployment model:** Each vault owner deploys their own GuardianRecovery contract instance. The contract address is stored in the vault blob (SQLite Settings table) or could be added as a VaultRegistry ledger field in a future story.

**Domain separators (CRITICAL — must be different from VaultRegistry):**
- Owner: `pad(32, "recovery:owner:")` — identifies vault owner in this contract
- Guardian: `pad(32, "recovery:guardian:")` — identifies guardian role

**Why different separators from VaultRegistry?** Each contract should have its own domain to prevent cross-contract commitment collisions. VaultRegistry uses `"vault:owner:"` and `"vault:backup:"`. GuardianRecovery uses `"recovery:owner:"` and `"recovery:guardian:"`. Even if the same key is used across contracts, commitments will be different.

**Ledger field design:**
```compact
export ledger owner: Bytes<32>;                  // Owner commitment (hiding)
export ledger guardians: Set<Bytes<32>>;         // Guardian commitment set (max 3)
export ledger guardianCount: Counter;            // Track count (Set.size() also works)
export ledger recoveryInitiatedAt: Uint<64>;     // 0 = no recovery (sentinel)
export ledger approvedGuardians: Set<Bytes<32>>; // Which guardians approved
export ledger sharesCidHash: Bytes<32>;          // Hash of IPFS CID with encrypted shares
export ledger recoveryComplete: Boolean;         // True after successful claim
```

**Circuit signatures:**
```compact
// Owner-only
export circuit initialize(ownerCom: Bytes<32>): []
export circuit addGuardian(guardianCom: Bytes<32>): []
export circuit removeGuardian(guardianCom: Bytes<32>): []
export circuit storeSharesCidHash(cidHash: Bytes<32>): []
export circuit initiateRecovery(currentTime: Uint<64>): []
export circuit cancelRecovery(): []
export circuit claimRecovery(): []

// Guardian-only
export circuit approveRecovery(): []

// Pure
export pure circuit ownerCommitment(sk: Bytes<32>): Bytes<32>
export pure circuit guardianCommitment(gk: Bytes<32>): Bytes<32>
```

### Known Limitations (document in contract + SPEC)

1. **Simulator cannot test positive `claimRecovery` flow** — Simulator block time = 0, cannot advance. Use `it.skip` with explanation. E2E on local Midnight network for time-lock verification.

2. **No cross-contract calls** — GuardianRecovery cannot directly call VaultRegistry to cancel backup transfers. The application layer (TypeScript) must coordinate between contracts.

### Anti-Patterns to Avoid

- **DO NOT** use `persistentHash` for identity — use `persistentCommit` (hiding commitment)
- **DO NOT** reuse VaultRegistry domain separators — each contract needs unique separators
- **DO NOT** store Shamir shares on-chain — shares go on IPFS, only the CID hash goes on-chain
- **DO NOT** use `currentTimestamp()` — use `blockTimeGte()` family
- **DO NOT** store the actual recovery key in this contract — only the CID hash of shares. Recovery key is in VaultRegistry (`recoveryKeyHash`) per Story 2.6
- **DO NOT** write `Uint<64>` arithmetic as `a + b` — must cast through Field: `(((a as Field) + (b as Field)) as Uint<64>)`

### Previous Story Learnings (from Epic 2)

**From Story 2.6 (VaultRegistry Full Spec):**
- Sentinel value `0` for "no activity" fields needs an `assert(time != 0)` guard at input
- `blockTimeGte(time)` validates provided time is not in the future
- `persistentCommit` with different domain separators prevents cross-role collisions
- Simulator block time = 0 makes time-lock positive tests impossible — use `it.skip`
- Counter type: `.increment(n)`, `.decrement(n)`, `.read()`, `.lessThan(n)`, `.resetToDefault()` — all work in circuits
- `Set.resetToDefault()` clears the entire set in-circuit — use in `cancelRecovery()` to clear `approvedGuardians`
- `Set.size()` returns `Uint<64>` comparable with `>=`
- `Map<K,V>` and `struct` are supported ledger ADTs in Compact (but flat fields used here for simplicity)

**From Story 2.1 (VaultRegistry):**
- Simulator pattern: each contract gets `*-simulator.ts` wrapping compiled contract
- `createCircuitContext` / `createConstructorContext` from `compact-runtime`
- Pure circuits accessible via `pureCircuits.*` on the contract
- Non-owner test: inject attacker's private state into owner's `circuitContext`

**From Story 2.5 (Deployment Scripts):**
- pnpm strict hoisting — add explicit dependencies for any new packages
- WSL required for compact compile on Windows

### Project Structure Notes

```
packages/blockchain/
├── contract/src/
│   ├── vault-registry.compact         # EXISTS: unchanged
│   ├── guardian-recovery.compact       # NEW: this story
│   ├── VAULT-REGISTRY-SPEC.md         # EXISTS: reference pattern
│   ├── GUARDIAN-RECOVERY-SPEC.md      # NEW: canonical specification
│   ├── witnesses.ts                   # EXISTS: may extend or create separate
│   ├── guardian-recovery-witnesses.ts # NEW: if separate witnesses file
│   ├── cid-utils.ts                   # EXISTS: reuse assertCIDv1 (unchanged)
│   ├── index.ts                       # MODIFY: add GuardianRecovery export
│   ├── managed/guardian-recovery/     # NEW: compiler output
│   └── test/
│       ├── guardian-recovery-simulator.ts  # NEW: simulator
│       └── guardian-recovery.test.ts      # NEW: unit tests
├── cli/src/
│   ├── guardian-recovery-types.ts     # NEW: TypeScript types
│   ├── guardian-recovery-api.ts       # NEW: API wrappers
│   └── test/
│       └── guardian-recovery-api.test.ts  # NEW: API tests
├── README.md                          # MODIFY: add GuardianRecovery section
└── package.json                       # EXISTS: no changes expected
```

### SDK Versions (VERIFIED WORKING — from Story 2.1/2.5/2.6)

- Compact CLI: 0.4.0 (language >= 0.20)
- compact-runtime: 0.14.0
- ledger-v7: 7.0.0
- midnight-js: 3.0.0
- wallet-sdk: 1.0.0

### Build Commands

```bash
# Compile contract (in WSL, from packages/blockchain/contract/)
compact compile src/guardian-recovery.compact src/managed/guardian-recovery

# Build TypeScript (in WSL, from packages/blockchain/contract/)
rm -rf dist && npx tsc --project tsconfig.build.json && cp -Rf ./src/managed ./dist/managed

# Run unit tests (from packages/blockchain/contract/)
npx vitest run

# Run CLI tests (from packages/blockchain/cli/)
npx vitest run
```

### Testing Strategy

- **Simulator tests:** All access control, guardian management, approval tracking, cancellation
- **Skipped tests:** `claimRecovery` positive flow (requires block-time mocking or E2E)
- **Cross-instance tests:** Attacker simulator with different private state to verify access control
- **Pure circuit tests:** Domain separator isolation between `ownerCommitment` and `guardianCommitment`
- **Edge cases:** Double-init, duplicate guardian, approve-without-recovery, cancel-without-recovery

### References

- [Source: _bmad-output/architecture.md#4-Guardian-Recovery-Configuration] — Recovery design with pseudocode (translate to Compact)
- [Source: _bmad-output/architecture.md#4-section-6-Cross-Device-Recovery] — GuardianRecovery pseudocode contract
- [Source: _bmad-output/project-context.md#Rule-9] — Compact Contract Ownership Pattern (persistentCommit)
- [Source: _bmad-output/project-context.md#Rule-10] — Compact Language Gotchas
- [Source: _bmad-output/project-context.md#Rule-11] — Contract Unit Testing Pattern (simulator)
- [Source: _bmad-output/project-context.md#Rule-12] — Midnight Private State is Device-Local (ADR-006)
- [Source: _bmad-output/project-context.md#Rule-14] — Compact Set Limitations & Sentinel Values
- [Source: packages/blockchain/contract/src/VAULT-REGISTRY-SPEC.md] — Canonical spec template to follow
- [Source: packages/blockchain/contract/src/vault-registry.compact] — Reference implementation for Compact patterns
- [Source: packages/blockchain/contract/src/test/vault-registry-simulator.ts] — Simulator pattern reference
- [Source: packages/blockchain/contract/src/test/vault-registry.test.ts] — Test pattern reference
- [Source: _bmad-output/implementation-artifacts/2-6-vaultregistry-contract-full-specification.md] — Previous story with all learnings
- [Source: _bmad-output/project-planning-artifacts/epics.md#Story-3.1] — Epic definition

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- Contract compilation: 8 circuits compiled successfully
- TypeScript typecheck: `npx tsc --project tsconfig.json --noEmit` passed cleanly
- Contract tests: 31 tests (30 passed, 1 skipped) — no regressions to existing Counter/VaultRegistry tests
- CLI tests: 8 API tests passed — no regressions to existing VaultRegistry/deploy-utils tests
- Risk mitigation: `approvedGuardians.size() >= (2 as Uint<64>)` compiled and works correctly (no fallback Counter needed)

### Completion Notes List
- All 12 tasks completed successfully
- `approvedGuardians.size() >= (2 as Uint<64>)` compiles correctly — risk mitigation fallback (Counter approach) was NOT needed
- Separate witnesses file (`guardian-recovery-witnesses.ts`) created to keep concerns isolated from VaultRegistry
- Guardian approval tests use `createGuardianContext()` helper to sync state between owner and guardian simulators
- Domain separators `"recovery:owner:"` and `"recovery:guardian:"` verified isolated from VaultRegistry's `"vault:owner:"` and `"vault:backup:"`

### File List

**Created:**
- `packages/blockchain/contract/src/guardian-recovery.compact` — Compact smart contract (Tasks 1-6)
- `packages/blockchain/contract/src/guardian-recovery-witnesses.ts` — TypeScript private state & witnesses (Task 7)
- `packages/blockchain/contract/src/managed/guardian-recovery/` — Compiler output directory (Task 8)
- `packages/blockchain/contract/src/test/guardian-recovery-simulator.ts` — Test simulator (Task 9)
- `packages/blockchain/contract/src/test/guardian-recovery.test.ts` — Unit tests (Task 10)
- `packages/blockchain/cli/src/guardian-recovery-types.ts` — Type definitions (Task 11)
- `packages/blockchain/cli/src/guardian-recovery-api.ts` — CLI API wrappers (Task 11)
- `packages/blockchain/cli/src/test/guardian-recovery-api.test.ts` — API unit tests (Task 11)
- `packages/blockchain/contract/src/GUARDIAN-RECOVERY-SPEC.md` — Canonical specification (Task 12)

**Modified:**
- `packages/blockchain/contract/src/index.ts` — Added GuardianRecovery + witnesses export (Task 8)
- `packages/blockchain/README.md` — Added GuardianRecovery section (Task 12)
- `_bmad-output/implementation-artifacts/3-1-guardian-smart-contract.md` — Checkboxes, dev record, file list
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — Status: `ready-for-dev` → `review`

### Senior Developer Review (AI)

**Reviewer:** Amelia (Dev Agent — adversarial code review mode)
**Date:** 2026-02-21
**Verdict:** Issues found and fixed

**Issues Found (8 total: 1 High, 5 Medium, 2 Low):**

1. **[HIGH] Removed guardian's approval still counts toward threshold** — `removeGuardian()` didn't invalidate approvals from `approvedGuardians`. Fixed by blocking `removeGuardian()` during active recovery (`assert(recoveryInitiatedAt == 0)`). Contract recompiled.
2. **[MEDIUM] `claimRecovery()` callable multiple times** — No guard against re-claiming after `recoveryComplete = true`. Fixed by adding `assert(!recoveryComplete, "Recovery already completed")`. Contract recompiled.
3. **[MEDIUM] `deployGuardianRecovery` and `joinGuardianRecovery` untested** — Added 2 tests verifying SDK integration calls.
4. **[MEDIUM] `getGuardianRecoveryLedgerState` untested** — Added 2 tests (null state, populated state).
5. **[MEDIUM] `package.json` modified but not in story File List** — Verified these changes are from a different work stream (Epic 2.6 vault-registry additions), not from this story. No action needed.
6. **[MEDIUM] Missing test for `storeSharesCidHash` overwrite behavior** — Added test confirming overwrite is intentionally allowed.
7. **[LOW] README structure section missing `guardian-recovery-api.test.ts`** — Fixed.
8. **[LOW] No documented limitation about post-recovery terminal state** — Added to GUARDIAN-RECOVERY-SPEC.md known limitations.

**Post-review test counts:**
- Contract tests: 72 total (69 passed, 3 skipped) — up from 69 (67 passed, 2 skipped)
- CLI API tests: 12 passed — up from 8

## Change Log
- 2026-02-08: Story 3.1 created by SM agent (Bob) — comprehensive specification with Compact constraint analysis, domain separator design, known limitations, and 12 implementation tasks
- 2026-02-21: Story 3.1 implemented — all 12 tasks complete, 31 contract tests (1 skipped), 8 CLI API tests, full regression green
- 2026-02-21: Code review — 8 issues found (1H, 5M, 2L), 7 fixed (contract recompiled with 2 new guards, 4 new tests added, docs updated), 1 verified no action needed (M4)
- 2026-02-21: Status → done. All docs updated: sprint-status, project-context (Rule 15), GUARDIAN-RECOVERY-SPEC, README
