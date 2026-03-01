# Story 3.6: Backup Wallet Configuration & Transfer

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to pre-register backup wallets that can transfer ownership after a maturation period,
so that I can recover my vault if I lose my primary wallet -- instantly if the backup was set up in advance.

## Acceptance Criteria

1. Contract: `backupWallets` changed from `Set<Bytes<32>>` to `Map<Bytes<32>, Uint<64>>` (commitment -> registration timestamp)
2. Contract: `addBackupWallet(walletCommitment, currentTime)` records registration timestamp (validated via `blockTimeGte`)
3. Contract: `backupTransfer(newOwnerCommitment)` checks `registeredAt + 72h <= blockTime`, transfers ownership, clears backup wallets and recovery state
4. Contract: Remove `initiateBackupTransfer`, `cancelBackupTransfer`, `transferInitiatedAt`, `transferInitiator` (replaced by maturity-based model)
5. Contract: Update `transferOwnership` to remove references to deleted state variables (`transferInitiatedAt`, `transferInitiator`)
6. Tests: Update all backup wallet tests for new Map-based design + maturity check
7. Tests: Verify maturity logic -- wallet registered < 72h cannot transfer, wallet >= 72h can transfer
8. Simulator: Update `VaultRegistrySimulator` to match new circuit signatures
9. CLI API: Update `vault-registry-api.ts` to match new circuit signatures, remove old functions
10. CLI API: Update `getVaultRegistryLedgerState()` to return Map-based backup wallet info
11. Spec doc: Update `VAULT-REGISTRY-SPEC.md` (if it exists in any form, update relevant documentation)
12. UI: Browser extension page to add/remove backup wallet commitments (Settings > Backup Wallets)
13. UI: Display backup wallet list with maturation status (time remaining or "ready")
14. UI: Backup wallet holder can execute transfer if wallet is mature

## Tasks / Subtasks

### Phase 1: Contract Modification (AC: #1, #2, #3, #4, #5)

- [x] Task 1: Modify `vault-registry.compact` for maturity-based model (AC: #1, #2, #3, #4, #5)
  - [x] 1.1 Change `backupWallets` from `Set<Bytes<32>>` to `Map<Bytes<32>, Uint<64>>`
  - [x] 1.2 Remove ledger declarations: `transferInitiatedAt: Uint<64>` and `transferInitiator: Bytes<32>`
  - [x] 1.3 Change `addBackupWallet` signature: `addBackupWallet(walletCommitment: Bytes<32>, currentTime: Uint<64>): []`
    - Validate `currentTime != 0` (sentinel) and `blockTimeGte(currentTime)` (not in the future)
    - Insert into Map: `backupWallets.insert(disclose(commitment), disclose(time))`
  - [x] 1.4 Change `removeBackupWallet` — use `backupWallets.remove(commitment)` (Map.remove same as Set.remove)
  - [x] 1.5 Remove circuits: `initiateBackupTransfer`, `executeBackupTransfer`, `cancelBackupTransfer`
  - [x] 1.6 Add new circuit: `backupTransfer(newOwnerCommitment: Bytes<32>): []`
    - Verify caller: `backupWallets.member(backupCommitment(bk))` where `bk = local_backup_key()`
    - Lookup registration time: `const registeredAt = backupWallets.lookup(backupCommitment(bk))`
    - Assert `registeredAt != (0 as Uint<64>)` — "Backup wallet not registered"
    - Calculate unlock time: `const unlockTime = (((registeredAt as Field) + (259200 as Field)) as Uint<64>)` (72h = 259200s)
    - Assert `blockTimeGte(unlockTime)` — "72-hour maturation period has not elapsed"
    - Transfer: `owner = disclose(newOwnerCommitment)`
    - Reset state: `recoveryKeyHash = default<Bytes<32>>; backupWallets.resetToDefault()`
  - [x] 1.7 Update `transferOwnership` — remove `transferInitiatedAt = 0 as Uint<64>; transferInitiator = default<Bytes<32>>;` lines
  - [x] 1.8 Update contract header comment block (ACCESS CONTROL MATRIX, STATE VARIABLES, FUNCTIONS list)
  - [x] 1.9 Compile: `cd packages/blockchain/contract && pnpm build` — zero errors

### Phase 2: Simulator Update (AC: #8)

- [x] Task 2: Update `vault-registry-simulator.ts` (AC: #8)
  - [x] 2.1 Change `addBackupWallet` method signature: `addBackupWallet(walletCommitment: Uint8Array, currentTime: bigint): Ledger`
  - [x] 2.2 Remove methods: `initiateBackupTransfer`, `executeBackupTransfer`, `cancelBackupTransfer`
  - [x] 2.3 Add new method: `backupTransfer(newOwnerCommitment: Uint8Array): Ledger`
  - [x] 2.4 Verify the `Ledger` type no longer includes `transferInitiatedAt` or `transferInitiator` fields

### Phase 3: Test Update (AC: #6, #7)

- [x] Task 3: Rewrite backup wallet tests in `vault-registry.test.ts` (AC: #6, #7)
  - [x] 3.1 Update `addBackupWallet / removeBackupWallet` describe block:
    - "owner can add a backup wallet with timestamp" — passes `commitment` + `1n` as currentTime
    - Verify: `backupWallets.member(commitment) == true` AND `backupWallets.lookup(commitment) == 1n`
    - "owner can remove a backup wallet" — `backupWallets.member(commitment) == false` after remove
    - "rejects zero timestamp (sentinel collision)" — `addBackupWallet(commitment, 0n)` should throw
    - Access control: non-owner add/remove tests (keep existing)
  - [x] 3.2 Remove entire `initiateBackupTransfer` describe block
  - [x] 3.3 Remove entire `executeBackupTransfer` describe block (both negative + positive flow)
  - [x] 3.4 Remove entire `cancelBackupTransfer` describe block
  - [x] 3.5 Add new `backupTransfer` describe block:
    - "rejects if caller is not a backup wallet" — attacker without membership
    - "rejects if maturation period not elapsed" (simulator block-time = 0, registeredAt > 0, `registeredAt + 259200` is always future) — This test verifies the assertion fires. **NOTE: Simulator block time defaults to 0. Register with `currentTime = 1n`, then `backupTransfer` will fail because `1 + 259200 > 0 (block time)`. This IS testable.**
    - `.skip` "full maturity flow (requires block-time mocking or E2E)" — same limitation as before
    - "transfers ownership when called by mature backup wallet" — `.skip` (needs block time > registeredAt + 259200)
    - "clears all backup wallets and recovery state after transfer" — `.skip` (same)
  - [x] 3.6 Update `transferOwnership` tests — remove assertions on `transferInitiatedAt` and `transferInitiator`
  - [x] 3.7 Update `createRegisteredOwner` helper if needed (no signature change expected)
  - [x] 3.8 Run: `cd packages/blockchain/contract && npx vitest run` — verify pass count

### Phase 4: CLI API Update (AC: #9, #10)

- [x] Task 4: Update `vault-registry-api.ts` (AC: #9, #10)
  - [x] 4.1 Update `addBackupWallet` function: add `currentTime: bigint` parameter
    ```typescript
    export const addBackupWallet = async (
      contract: DeployedVaultRegistryContract,
      walletCommitment: Uint8Array,
      currentTime: bigint,
    ): Promise<void> => {
      logger.info(`Adding backup wallet (registeredAt=${currentTime})...`);
      const result = await contract.callTx.addBackupWallet(walletCommitment, currentTime);
      logger.info(`addBackupWallet tx ${result.public.txId} in block ${result.public.blockHeight}`);
    };
    ```
  - [x] 4.2 Remove functions: `initiateBackupTransfer`, `executeBackupTransfer`, `cancelBackupTransfer`
  - [x] 4.3 Add `backupTransfer` function:
    ```typescript
    export const backupTransfer = async (
      contract: DeployedVaultRegistryContract,
      newOwnerCommitment: Uint8Array,
    ): Promise<void> => {
      logger.info('Executing backup transfer...');
      const result = await contract.callTx.backupTransfer(newOwnerCommitment);
      logger.info(`backupTransfer tx ${result.public.txId} in block ${result.public.blockHeight}`);
    };
    ```
  - [x] 4.4 Update `getVaultRegistryLedgerState` return type:
    - Remove `transferInitiatedAt: bigint` and `transferInitiator: Uint8Array`
    - Change `backupWalletsEmpty: boolean` to `backupWalletsEmpty: boolean` (keep for backward compat)
    - Optionally add `backupWalletsSize: bigint` for UI display
  - [x] 4.5 Run: `cd packages/blockchain/cli && npx vitest run` — verify no regressions

### Phase 5: Browser Extension UI — Backup Wallet Management (AC: #12, #13)

- [x] Task 5: Create BackupWalletService (AC: #12, #13)
  - [x] 5.1 Create `apps/browser-extension/src/services/BackupWalletService.ts`:
    - `addBackupWallet(contractAddress: string, backupKey: Uint8Array, currentTime: bigint): Promise<void>`
      - Compute `commitment = backupCommitment(backupKey)` using pure circuit via contract API
      - Call `contract.callTx.addBackupWallet(commitment, currentTime)`
    - `removeBackupWallet(contractAddress: string, commitment: Uint8Array): Promise<void>`
      - Call `contract.callTx.removeBackupWallet(commitment)`
    - `getBackupWalletStatus(contractAddress: string): Promise<BackupWalletInfo[]>`
      - Read ledger state, iterate backup wallets Map via TypeScript `[Symbol.iterator]()`
      - For each entry: compute maturation deadline (`registeredAt + 259200`), compare with `Date.now() / 1000`
      - Return array of `{ commitment: Uint8Array, registeredAt: bigint, matured: boolean, timeRemaining: number }`
    - `executeBackupTransfer(contractAddress: string, backupKey: Uint8Array, newOwnerCommitment: Uint8Array): Promise<void>`
      - Join contract with backupKey in private state
      - Call `contract.callTx.backupTransfer(newOwnerCommitment)`

- [x] Task 6: Create BackupWallets settings page (AC: #12, #13)
  - [x] 6.1 Create `apps/browser-extension/src/entrypoints/popup/pages/settings/BackupWallets.tsx`
  - [x] 6.2 Page sections:
    1. **Backup Wallet List**: Display existing backup wallets from ledger state
       - Each row: truncated commitment hash, registration date, maturation status ("Ready" badge or countdown "Matures in Xh Ym")
       - "Remove" button per wallet (owner only)
    2. **Add Backup Wallet**: Form with backup key input (hex or generate new)
       - "Add Backup Wallet" button -> calls `addBackupWallet` with `Math.floor(Date.now() / 1000)` as currentTime
       - Explain that the backup key must be stored securely by the backup wallet holder
    3. **Security Info**: Explain 72h maturation period and why it matters
  - [x] 6.3 Add route to `App.tsx`: `{ path: '/settings/backup-wallets', element: <BackupWallets />, showBackButton: true, title: 'Backup Wallets' }`
  - [x] 6.4 Add navigation link in `Settings.tsx` page to "Backup Wallets" section

### Phase 6: Browser Extension UI — Backup Transfer Execution (AC: #14)

- [x] Task 7: Create BackupTransfer page (AC: #14)
  - [x] 7.1 Create `apps/browser-extension/src/entrypoints/popup/pages/recovery/BackupTransfer.tsx`
  - [x] 7.2 Page flow (state machine):
    1. **Identify**: User enters the VaultRegistry contract address of the vault they want to transfer
    2. **Verify**: Read ledger state, check if connected wallet's backup commitment is registered and mature
    3. **Transfer**: User provides new owner commitment (their new wallet's secret key commitment)
    4. **Execute**: Call `backupTransfer(newOwnerCommitment)` on contract
    5. **Confirm**: Display success — "Ownership transferred. You are now the new owner."
  - [x] 7.3 Error states: wallet not detected, backup wallet not registered, maturation not elapsed, transfer failed
  - [x] 7.4 Add route to `App.tsx`: `{ path: '/recovery/backup-transfer', element: <BackupTransfer />, showBackButton: true, title: 'Backup Transfer' }`

### Phase 7: Tests for UI Components (AC: #6)

- [x] Task 8: Tests for BackupWalletService (AC: #6)
  - [x] 8.1 Create `apps/browser-extension/src/services/__tests__/BackupWalletService.test.ts`:
    - Test `addBackupWallet()` calls contract with correct commitment + timestamp
    - Test `removeBackupWallet()` calls contract with correct commitment
    - Test `getBackupWalletStatus()` returns correct maturation status (mature vs pending)
    - Test `executeBackupTransfer()` calls contract backupTransfer with correct args
    - Test error propagation for each function

- [x] Task 9: Tests for UI pages (AC: #6)
  - [x] 9.1 Create `apps/browser-extension/src/entrypoints/popup/pages/settings/__tests__/BackupWallets.test.tsx`:
    - Test backup wallet list renders with maturation status
    - Test add backup wallet form submission
    - Test remove backup wallet button
    - Test countdown display for immature wallets
    - Test "Ready" badge for mature wallets
  - [x] 9.2 Create `apps/browser-extension/src/entrypoints/popup/pages/recovery/__tests__/BackupTransfer.test.tsx`:
    - Test verification flow (registered + mature)
    - Test rejection (not registered or not mature)
    - Test successful transfer execution
    - Test error states

### Phase 8: Build & Verify (AC: all)

- [x] Task 10: Build and regression testing (AC: all)
  - [x] 10.1 Compile contract: `cd packages/blockchain/contract && pnpm build` -- zero errors
  - [x] 10.2 Contract tests: `cd packages/blockchain/contract && npx vitest run` -- all pass (compare to baseline: 69 passed, 3 skipped)
  - [x] 10.3 CLI tests: `cd packages/blockchain/cli && npx vitest run` -- all pass (baseline: 41 passed, 1 skipped)
  - [x] 10.4 Extension build: `cd apps/browser-extension && pnpm build` -- no new errors
  - [x] 10.5 Extension tests: `cd apps/browser-extension && npx vitest run` -- no new failures
  - [x] 10.6 Regression: `cd shared/vault-sync && npx vitest run` -- no regressions (97 pass baseline)
  - [x] 10.7 Regression: `cd services/guardian-portal && npx vitest run` -- no regressions (100 pass baseline)

## Dev Notes

### Design Rationale: Maturity-Based Time-Lock (CRITICAL)

The existing contract (Story 2.6) uses an **initiate-wait-execute** three-step flow for backup transfers:

1. Backup wallet calls `initiateBackupTransfer(currentTime)` -- records timestamp + initiator commitment
2. Wait 72 hours
3. Backup wallet calls `executeBackupTransfer(newOwnerCommitment)` -- verifies initiator, checks time-lock

Story 3.6 replaces this with a simpler **maturity-based** model:

1. Owner calls `addBackupWallet(walletCommitment, currentTime)` -- records registration timestamp in Map
2. After 72h maturation, backup wallet calls `backupTransfer(newOwnerCommitment)` -- single step
3. Owner can `removeBackupWallet(commitment)` at any time before transfer

**Why this is better:**
- **Simpler:** One circuit (`backupTransfer`) instead of three (`initiateBackupTransfer`, `executeBackupTransfer`, `cancelBackupTransfer`)
- **Fewer state variables:** Remove `transferInitiatedAt` and `transferInitiator` from ledger
- **Better UX:** A backup wallet set up 72h+ ago can transfer INSTANTLY (no initiation delay)
- **Same security:** Owner has the same 72h window to notice and revoke a rogue backup wallet

### Contract Changes — Exact Diff

**Ledger state changes:**
```compact
// REMOVE these two lines:
export ledger transferInitiatedAt: Uint<64>;
export ledger transferInitiator: Bytes<32>;

// CHANGE this line:
// FROM:
export ledger backupWallets: Set<Bytes<32>>;
// TO:
export ledger backupWallets: Map<Bytes<32>, Uint<64>>;
```

**Circuit changes:**
```compact
// CHANGE addBackupWallet — add currentTime parameter
export circuit addBackupWallet(walletCommitment: Bytes<32>, currentTime: Uint<64>): [] {
  const commitment = disclose(walletCommitment);
  const time = disclose(currentTime);
  const sk = local_secret_key();
  assert(owner == ownerCommitment(sk), "Not the vault owner");
  // Reject zero timestamp — 0 is sentinel for "not registered"
  assert(time != (0 as Uint<64>), "Invalid timestamp");
  // Validate provided time is not in the future
  assert(blockTimeGte(time), "Provided time is in the future");
  backupWallets.insert(commitment, time);
}

// KEEP removeBackupWallet unchanged — Map.remove(key) works same as Set.remove(value)
export circuit removeBackupWallet(walletCommitment: Bytes<32>): [] {
  const commitment = disclose(walletCommitment);
  const sk = local_secret_key();
  assert(owner == ownerCommitment(sk), "Not the vault owner");
  backupWallets.remove(commitment);
}

// ADD new backupTransfer circuit
export circuit backupTransfer(newOwnerCommitment: Bytes<32>): [] {
  const newOwner = disclose(newOwnerCommitment);
  const bk = local_backup_key();
  const callerCommitment = backupCommitment(bk);
  assert(backupWallets.member(callerCommitment), "Not a backup wallet");
  // Check maturation: registeredAt + 72h must have elapsed
  const registeredAt = backupWallets.lookup(callerCommitment);
  assert(registeredAt != (0 as Uint<64>), "Backup wallet not registered");
  const unlockTime = (((registeredAt as Field) + (259200 as Field)) as Uint<64>);
  assert(blockTimeGte(unlockTime), "72-hour maturation period has not elapsed");
  // Transfer ownership
  owner = newOwner;
  // Reset recovery-related state
  recoveryKeyHash = default<Bytes<32>>;
  // Clear all backup wallets — new owner starts with a clean slate
  backupWallets.resetToDefault();
}

// REMOVE these three circuits entirely:
// - initiateBackupTransfer
// - executeBackupTransfer
// - cancelBackupTransfer

// UPDATE transferOwnership — remove transferInitiatedAt and transferInitiator references:
export circuit transferOwnership(newOwnerCommitment: Bytes<32>): [] {
  const newOwner = disclose(newOwnerCommitment);
  const sk = local_secret_key();
  assert(owner == ownerCommitment(sk), "Not the vault owner");
  owner = newOwner;
  // Reset recovery-related state
  recoveryKeyHash = default<Bytes<32>>;
  // Clear all backup wallets — new owner starts with a clean slate
  backupWallets.resetToDefault();
  // NOTE: transferInitiatedAt and transferInitiator lines REMOVED (no longer exist)
}
```

### Compact Map Operations Reference (from MCP research + project-context.md Rule 14)

All Map operations work IN circuits (verified):
- `Map.insert(key, value)` -- adds or updates entry
- `Map.remove(key)` -- removes entry
- `Map.lookup(key)` -- returns value_type (NOT Maybe; check `.member()` first for safety)
- `Map.member(key)` -- returns Boolean (key exists?)
- `Map.isEmpty()` -- returns Boolean
- `Map.size()` -- returns Uint<64>
- `Map.resetToDefault()` -- clears entire map

**CRITICAL:** `Map.lookup()` returns `value_type` directly (not `Maybe<value_type>`). If the key does not exist, behavior is undefined. Always guard with `.member()` first:
```compact
assert(backupWallets.member(callerCommitment), "Not a backup wallet");
const registeredAt = backupWallets.lookup(callerCommitment);
```

**TypeScript iteration:** `[Symbol.iterator]()` is available in TypeScript SDK (NOT in circuits). Use this for the UI to list all backup wallets with their registration timestamps.

### Uint<64> Arithmetic Cast Pattern (from project-context.md Rule 10)

```compact
// Compact Uint arithmetic requires cast through the result type
const unlockTime = (((registeredAt as Field) + (259200 as Field)) as Uint<64>);
// This is: cast both operands to Field, add, cast result back to Uint<64>
```

### blockTimeGte Usage Pattern (from project-context.md Rule 10)

```compact
// blockTimeGte(timestamp) returns true if current block time >= timestamp
// Available since Compact 0.17. Also: blockTimeGt, blockTimeLt, blockTimeLte
assert(blockTimeGte(time), "Provided time is in the future");
assert(blockTimeGte(unlockTime), "72-hour maturation period has not elapsed");
```

### Simulator Block-Time Limitation (CRITICAL)

From project-context.md Rule 11 and Story 2.6:
> Simulator block time defaults to 0 and cannot be advanced. `blockTimeGte(unlockTime)` is impossible to satisfy with real timestamps + offsets. Use E2E on local Midnight network for time-lock testing.

**Impact on tests:**
- `addBackupWallet(commitment, 1n)` WILL work because `blockTimeGte(1)` with block time 0 FAILS. Wait -- actually `blockTimeGte(1)` means "assert block time >= 1" but block time is 0, so this assertion FAILS.

**Workaround:** In the simulator, the only value that passes `blockTimeGte(time)` where block time = 0 is `time = 0`. But we reject 0 as sentinel. This means `addBackupWallet` with any valid time > 0 will fail in simulator too.

**However**, looking at the existing test for `initiateBackupTransfer(1n)` on line 265 of `vault-registry.test.ts`, it PASSES. This means `blockTimeGte(1)` passes when simulator block time is 0? Let's check: the existing contract has `assert(blockTimeGte(time), "Provided time is in the future")` and the test passes `1n`. This implies that either:
1. Simulator block time is not actually 0 (it may be some default that satisfies `blockTimeGte(1)`)
2. Or `blockTimeGte` in the simulator always returns true

The existing tests show that `initiateBackupTransfer(1n)` passes, which contains `assert(blockTimeGte(time), ...)`. So `blockTimeGte(1)` passes in the simulator. This means we CAN test `addBackupWallet(commitment, 1n)`.

The 72h maturity check (`blockTimeGte(1 + 259200)` = `blockTimeGte(259201)`) will likely FAIL in the simulator -- matching the existing `.skip` test for `executeBackupTransfer`.

**Test strategy:**
- `addBackupWallet(commitment, 1n)` -- should pass (same as existing `initiateBackupTransfer(1n)`)
- `backupTransfer` with registeredAt=1 -- will FAIL due to `blockTimeGte(259201)` -- this IS the test for "maturation not elapsed"
- Full maturity flow: `.skip` (needs real block time)

### Existing Test Helpers to Reuse

From `vault-registry.test.ts`:
```typescript
const makeSecretKey = (): Uint8Array => crypto.randomBytes(32);
const makeAddrHash = (seed: number): Uint8Array => { /* ... */ };
const ZERO_BYTES_32 = new Uint8Array(32);
const createRegisteredOwner = (sk?, backupKey?) => { /* ... */ };
const createAttackerContext = (ownerSim, attackerSk, attackerBackupKey?) => { /* ... */ };
```

### Files to Modify (with exact paths from project root)

| File | Action | Notes |
|------|--------|-------|
| `packages/blockchain/contract/src/vault-registry.compact` | MODIFY | Core contract changes (Set->Map, new circuit, remove 3 circuits) |
| `packages/blockchain/contract/src/test/vault-registry-simulator.ts` | MODIFY | Update method signatures, add/remove methods |
| `packages/blockchain/contract/src/test/vault-registry.test.ts` | MODIFY | Rewrite backup tests, remove initiate/execute/cancel tests |
| `packages/blockchain/cli/src/vault-registry-api.ts` | MODIFY | Update addBackupWallet, remove 3 functions, add backupTransfer |
| `packages/blockchain/contract/src/witnesses.ts` | NO CHANGE | Witnesses unchanged (local_secret_key, local_backup_key still needed) |
| `apps/browser-extension/src/entrypoints/popup/App.tsx` | MODIFY | Add 2 new routes |
| `apps/browser-extension/src/services/BackupWalletService.ts` | NEW | Service for backup wallet operations |
| `apps/browser-extension/src/services/__tests__/BackupWalletService.test.ts` | NEW | Service tests |
| `apps/browser-extension/src/entrypoints/popup/pages/settings/BackupWallets.tsx` | NEW | Backup wallet management page |
| `apps/browser-extension/src/entrypoints/popup/pages/settings/__tests__/BackupWallets.test.tsx` | NEW | Page tests |
| `apps/browser-extension/src/entrypoints/popup/pages/recovery/BackupTransfer.tsx` | NEW | Backup transfer execution page |
| `apps/browser-extension/src/entrypoints/popup/pages/recovery/__tests__/BackupTransfer.test.tsx` | NEW | Page tests |

### Architecture Compliance (CRITICAL)

**Rule 3 (ADR-003): Shared Business Logic.** The backup wallet service in the browser extension is a thin wrapper around contract calls. There is minimal business logic -- the maturation check is done ON-CHAIN. The extension UI only reads ledger state and displays maturation status. No shared package needed for this story because the logic is contract-level (Compact), not application-level (TypeScript).

**Rule 9: Compact Ownership Pattern.** The `backupCommitment(bk)` pure circuit uses `persistentCommit<Bytes<32>>(pad(32, "vault:backup:"), bk)` -- different domain separator from `ownerCommitment`. This is already implemented and does not change.

**Rule 10: Compact Language Gotchas.** Key gotchas for this story:
- `disclose()` required on all circuit params before ledger use
- `default<Bytes<32>>` (no parentheses) for zero-value reset
- `Uint<64>` arithmetic: `(((a as Field) + (b as Field)) as Uint<64>)`
- `blockTimeGte(time)` for time validation
- `Map.insert(key, value)` -- two arguments (not `.insert(value)` like Set)

**Rule 11: Contract Unit Testing Pattern.** The simulator wraps compiled contract with typed methods. `pureCircuits.backupCommitment(bk)` for off-circuit verification. `circuitContext` is public for cross-instance access control testing.

**Rule 14: Compact ADT Operations.** Map operations are all available in circuits. `Map.resetToDefault()` clears entire Map in one call (same as existing `backupWallets.resetToDefault()` for Set). The existing Set `resetToDefault()` in `transferOwnership` will work unchanged for Map.

### What NOT to Do (Anti-Patterns)

- **DO NOT** keep `transferInitiatedAt` or `transferInitiator` "just in case" -- they are replaced by the Map timestamp. Clean removal is required.
- **DO NOT** try to iterate `backupWallets` Map in circuits -- iteration is TypeScript-only. In circuits, use `.member()` and `.lookup()`.
- **DO NOT** use `Map.lookup(key)` without first checking `Map.member(key)` -- behavior is undefined for missing keys.
- **DO NOT** use `0` as a valid registration timestamp -- `0` is the sentinel for "not registered".
- **DO NOT** add a `cancelBackupTransfer` circuit -- the maturity model replaces it. Owner uses `removeBackupWallet` to revoke.
- **DO NOT** store backup wallet keys in `chrome.storage.local` only -- follow Rule 12 (store in encrypted vault blob for cross-device access).
- **DO NOT** import from `apps/browser-extension/` in contract or CLI packages -- violates ADR-003 dependency direction.
- **DO NOT** use `Buffer` in browser extension code -- use `Uint8Array` everywhere for browser compatibility.
- **DO NOT** skip the contract compilation step -- the Set-to-Map change affects generated TypeScript types.

### Previous Story Learnings (Stories 2.6, 3.1, 3.2v2, 3.3, 3.4)

**From Story 2.6 (VaultRegistry Full Specification):**
- Backup wallet circuits were first implemented here with Set-based model
- `backupCommitment` pure circuit uses `"vault:backup:"` domain separator (different from `"vault:owner:"`)
- `blockTimeGte(time)` validated in simulator tests -- `initiateBackupTransfer(1n)` passes
- Sentinel value pattern: `assert(time != (0 as Uint<64>), "Invalid timestamp")`

**From Story 3.4 (Recovery Claim Flow):**
- Contract state reading pattern: `providers.publicDataProvider.queryContractState(contractAddress)` + `VaultRegistry.ledger(contractState.data)` for fresh reads
- Browser extension uses dynamic imports for packages not in npm workspace (RecoveryClaimService pattern)
- ShareClaim uses multi-step wizard UI pattern with `PageState` type

**From Story 3.3 (Guardian Portal):**
- ApprovalPage state machine pattern: `'loading' | 'error' | 'connect-wallet' | ...`
- Settings pages follow consistent pattern with back button + title

**From Story 3.1 (Guardian Contract):**
- State mutation guards: block operations that would invalidate in-progress processes
- Post-transfer cleanup: `backupWallets.resetToDefault()` clears all entries atomically

### SDK Versions (VERIFIED WORKING)

| Component | Version |
|-----------|---------|
| Compact CLI | 0.4.0 (language >= 0.20) |
| compact-runtime | 0.14.0 |
| midnight-js-contracts | 3.0.0 |
| midnight-js-http-client-proof-provider | 3.0.0 |
| midnight-js-indexer-public-data-provider | 3.0.0 |
| wallet-sdk | 1.0.0 |
| React | 18+ |
| Vite | 6+ |
| TypeScript | 5+ |
| Vitest | latest |

### Build Commands

```bash
# Install workspace dependencies (from project root)
pnpm install

# Compile contract (CRITICAL — must do before tests)
cd packages/blockchain/contract && pnpm build

# Run contract tests
cd packages/blockchain/contract && npx vitest run

# Run CLI tests
cd packages/blockchain/cli && npx vitest run

# Build browser extension
cd apps/browser-extension && pnpm build

# Run browser extension tests
cd apps/browser-extension && npx vitest run

# Regression checks
cd shared/vault-sync && npx vitest run
cd services/guardian-portal && npx vitest run
```

### Cross-Story Context

| Story | Relationship |
|-------|-------------|
| 2.6 (VaultRegistry Full) | **Done.** Original Set-based backup wallet circuits. This story modifies them to Map-based. |
| 3.1 (Guardian Contract) | **Done.** GuardianRecovery is separate contract. No changes needed. Guardian recovery still takes precedence over backup transfer (application layer coordination). |
| 3.4 (Recovery Claim) | **Done.** Browser extension pages pattern (recovery/ directory). Reuse routing pattern. |
| 3.5 (Ownership Transfer) | **Descoped.** Direct transfer UI not needed because 3.6 provides fast path for mature backup wallets. `transferOwnership` circuit stays but gets no UI. |
| 3.7 (Guardian Portal Build) | **Ready-for-dev.** No dependency on 3.6. Portal does not interact with backup wallets. |

### Project Structure Notes

Contract modifications are in-place:
```
packages/blockchain/
├── contract/src/
│   ├── vault-registry.compact         # MODIFY (core contract)
│   ├── witnesses.ts                   # NO CHANGE
│   └── test/
│       ├── vault-registry.test.ts     # MODIFY (rewrite backup tests)
│       └── vault-registry-simulator.ts # MODIFY (update signatures)
├── cli/src/
│   ├── vault-registry-api.ts          # MODIFY (update API)
│   └── vault-registry-types.ts        # NO CHANGE (types auto-generated)
```

Browser extension additions:
```
apps/browser-extension/src/
├── services/
│   ├── BackupWalletService.ts                     # NEW
│   └── __tests__/
│       └── BackupWalletService.test.ts            # NEW
└── entrypoints/popup/
    ├── App.tsx                                     # MODIFY (add routes)
    └── pages/
        ├── settings/
        │   ├── BackupWallets.tsx                   # NEW
        │   └── __tests__/
        │       └── BackupWallets.test.tsx          # NEW
        └── recovery/
            ├── BackupTransfer.tsx                  # NEW
            └── __tests__/
                └── BackupTransfer.test.tsx         # NEW
```

### References

- [Source: _bmad-output/project-planning-artifacts/epics.md#Story-3.6] -- Epic definition with maturity-based design
- [Source: _bmad-output/project-context.md#Rule-10] -- Compact language gotchas (blockTimeGte, Uint arithmetic, disclose)
- [Source: _bmad-output/project-context.md#Rule-11] -- Contract unit testing pattern (simulator)
- [Source: _bmad-output/project-context.md#Rule-14] -- Compact ADT operations (Map.insert, Map.lookup, Map.member, Map.resetToDefault)
- [Source: _bmad-output/project-context.md#Rule-9] -- Compact ownership pattern (persistentCommit domain separators)
- [Source: _bmad-output/project-context.md#Rule-3] -- Shared business logic enforcement (ADR-003)
- [Source: _bmad-output/project-context.md#Rule-12] -- Midnight private state is device-local (ADR-006)
- [Source: packages/blockchain/contract/src/vault-registry.compact] -- Current contract (242 lines, Set-based backupWallets)
- [Source: packages/blockchain/contract/src/test/vault-registry.test.ts] -- Current tests (393 lines, 69 pass + 3 skip)
- [Source: packages/blockchain/contract/src/test/vault-registry-simulator.ts] -- Current simulator (142 lines)
- [Source: packages/blockchain/cli/src/vault-registry-api.ts] -- Current CLI API (229 lines)
- [Source: packages/blockchain/contract/src/witnesses.ts] -- Witness definitions (57 lines)
- [Source: packages/blockchain/cli/src/vault-registry-types.ts] -- Type definitions (18 lines)
- [Source: apps/browser-extension/src/entrypoints/popup/App.tsx] -- Extension router (270 lines)
- [Source: _bmad-output/implementation-artifacts/3-4-recovery-claim-flow-pattern-6.md] -- Story 3.4 with recovery claim patterns
- [Source: _bmad-output/architecture.md#Backup-Wallet-Transfer] -- Architecture pseudocode for backup wallet flow
- [Source: MCP midnight-get-latest-syntax] -- Compact Map ADT operations verified (insert, lookup, member, remove, isEmpty, size, resetToDefault)
- [Source: MCP midnight-search-compact] -- Map<K,V> usage patterns from midnight-bank and compact-export examples

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- blockTimeGte() in simulator always returns true regardless of argument — confirmed by existing initiateBackupTransfer(1n) test passing AND Story 3.6 backupTransfer tests. This means time-lock tests (maturity check) must be .skip with E2E justification. Added to project-context.md Rule 11.
- `pnpm build` in contract package only runs `tsc`, NOT Compact compilation. Must run `pnpm compact:vault-registry` first when contract source changes.
- `@aliasvault/contract` cannot be resolved from browser extension at Vite transform time. Components must not directly import it — use service wrappers with dynamic imports instead. Added as project-context.md Rule 19.
- `parseInt("gg", 16)` returns NaN, Uint8Array coerces NaN to 0 — silent data corruption that can permanently lock a vault. Always validate hex with regex first. Added as project-context.md Rule 20.
- VaultCidStore.getSecretKey() is accessible from popup pages (not just background scripts). Pattern used by BackupWallets.tsx for owner auth. Added as project-context.md Rule 21.

### Completion Notes List

- AC #1: backupWallets changed from Set<Bytes<32>> to Map<Bytes<32>, Uint<64>>
- AC #2: addBackupWallet now accepts currentTime, validates via blockTimeGte + sentinel check
- AC #3: backupTransfer checks registeredAt + 72h maturity, transfers ownership, clears state
- AC #4: Removed initiateBackupTransfer, cancelBackupTransfer, transferInitiatedAt, transferInitiator
- AC #5: transferOwnership updated — no longer references deleted state variables
- AC #6: All test suites pass — contract (64 pass, 6 skip), CLI (39 pass), extension (248 pass + 8 pre-existing FormFiller failures), vault-sync (97 pass)
- AC #7: Maturity logic tested — non-backup-wallet rejection passes; maturity time-lock test skipped (simulator limitation); sentinel collision test passes
- AC #8: Simulator updated with new method signatures
- AC #9: CLI API updated — addBackupWallet with timestamp, removed 3 old functions, added backupTransfer
- AC #10: getVaultRegistryLedgerState returns Map-based backup wallet info with backupWalletsSize
- AC #11: No VAULT-REGISTRY-SPEC.md found; contract header comment block updated
- AC #12: BackupWallets settings page with contract input, wallet list, add form, security info
- AC #13: Backup wallet list shows maturation status (Ready badge or countdown)
- AC #14: BackupTransfer page with state machine flow (identify → verify → transfer → success)
- Additional: Added computeBackupCommitment() helper to BackupWalletService to avoid direct @aliasvault/contract imports from TSX components (Rule 19)
- Post-review fix C1: BackupWallets.tsx add/remove handlers wired to real BackupWalletService calls via VaultCidStore secret key
- Post-review fix H1/H2: Created `utils/hex.ts` with regex-validated hexToBytes — prevents NaN→0 silent corruption (Rule 20)
- Post-review fix L1: Extracted shared hex utilities, eliminating duplicate functions in BackupWallets.tsx and BackupTransfer.tsx
- Post-review: BackupWallets.test.tsx expanded from 8 to 12 tests (added service integration + VaultCidStore mock tests)

### Change Log

- 2026-02-28: Story 3.6 created by SM agent (Claude Opus 4.6). 10 tasks across 8 phases: contract modification (Set->Map maturity model), simulator update, test rewrite, CLI API update, backup wallet management UI, backup transfer execution UI, UI tests, and build verification.
- 2026-03-01: Post-implementation code review fixes (Claude Opus 4.6). C1 (CRITICAL): BackupWallets.tsx handlers rewired from stubs to real service calls via VaultCidStore. H1/H2 (HIGH): Created `utils/hex.ts` with regex-validated `hexToBytes` to prevent NaN→0 silent corruption. L1 (LOW): Extracted shared hex utilities from duplicate implementations in BackupWallets.tsx and BackupTransfer.tsx. Added `computeBackupCommitment()` wrapper to BackupWalletService (Rule 19 — Vite import constraint). 29 tests pass (7 service + 12 BackupWallets + 10 BackupTransfer).
- 2026-03-01: Story 3.6 implemented by Dev agent (Claude Opus 4.6). All 10 tasks complete. Contract compiled with zero errors. 64+39+248+97 = 448 tests pass across all packages (6 skipped in contract, 8 pre-existing FormFiller failures in extension).

### File List

| File | Action | Lines |
|------|--------|-------|
| `packages/blockchain/contract/src/vault-registry.compact` | MODIFIED | Set→Map, +backupTransfer, -3 circuits, -2 ledger vars |
| `packages/blockchain/contract/src/test/vault-registry-simulator.ts` | MODIFIED | Updated method signatures |
| `packages/blockchain/contract/src/test/vault-registry.test.ts` | MODIFIED | Rewrote backup tests, 64 pass + 6 skip |
| `packages/blockchain/cli/src/vault-registry-api.ts` | MODIFIED | +backupTransfer, -3 old functions, updated addBackupWallet |
| `packages/blockchain/cli/src/test/vault-registry-api.test.ts` | MODIFIED | Updated for new API |
| `apps/browser-extension/src/utils/hex.ts` | NEW | Shared hex utilities (isValidHex, hexToBytes, bytesToHex, truncateHex, formatTimeRemaining) |
| `apps/browser-extension/src/services/BackupWalletService.ts` | NEW | Backup wallet CRUD + computeBackupCommitment |
| `apps/browser-extension/src/services/__tests__/BackupWalletService.test.ts` | NEW | 7 tests |
| `apps/browser-extension/src/entrypoints/popup/pages/settings/BackupWallets.tsx` | NEW | Settings page |
| `apps/browser-extension/src/entrypoints/popup/pages/settings/__tests__/BackupWallets.test.tsx` | NEW | 12 tests |
| `apps/browser-extension/src/entrypoints/popup/pages/recovery/BackupTransfer.tsx` | NEW | Transfer page |
| `apps/browser-extension/src/entrypoints/popup/pages/recovery/__tests__/BackupTransfer.test.tsx` | NEW | 10 tests |
| `apps/browser-extension/src/entrypoints/popup/App.tsx` | MODIFIED | +2 routes |
| `apps/browser-extension/src/entrypoints/popup/pages/settings/Settings.tsx` | MODIFIED | +Backup Wallets nav link |
