# Story 5.0: Email Keypair & Relay Authorization

Status: review

## Story

As a user,
I want an encryption keypair generated for my vault and the email relay authorized,
so that the SMTP bridge can encrypt emails only I can read, and deliver notifications to my vault.

## Acceptance Criteria

1. X25519 keypair generated client-side (browser extension) during vault creation or lazily on first alias claim
2. Public key (32 bytes) stored on-chain via `VaultRegistry.setEmailPublicKey(pubKey: Bytes<32>)`
3. Private key stored in vault blob (VaultJson `emailKeyPair.privateKey` — base64-encoded)
4. `setMailRelay(relayCommitment: Bytes<32>)` circuit added to VaultRegistry (owner-only)
5. `notifyNewMail(manifestCid: Opaque<'string'>)` circuit added to VaultRegistry (relay-only)
6. New ledger variables: `emailPublicKey: Bytes<32>`, `emailCount: Counter`, `inboxManifestCid: Opaque<'string'>`, `mailRelay: Bytes<32>`
7. New witness: `local_relay_key(): Bytes<32>` returning relay secret key from private state
8. Relay commitment pattern uses domain separator `"vault:relay:"` (consistent with `"vault:owner:"` and `"vault:backup:"`)
9. Unit tests: `setEmailPublicKey` (owner-only), `setMailRelay` (owner-only), `notifyNewMail` (relay-only, unauthorized rejected)
10. Existing VaultRegistry tests still pass (no regressions)

## Tasks / Subtasks

- [x] Task 1: Add email ledger variables to `vault-registry.compact` (AC: 6)
  - [x] 1.1 Add `emailPublicKey: Bytes<32>` ledger variable
  - [x] 1.2 Add `emailCount: Counter` ledger variable
  - [x] 1.3 Add `inboxManifestCid: Opaque<'string'>` ledger variable
  - [x] 1.4 Add `mailRelay: Bytes<32>` ledger variable
  - [x] 1.5 Add `witness local_relay_key(): Bytes<32>` declaration
- [x] Task 2: Add `relayCommitment` pure circuit (AC: 8)
  - [x] 2.1 Implement `circuit relayCommitment(rk: Bytes<32>): Bytes<32>` using `persistentCommit<Bytes<32>>(pad(32, "vault:relay:"), rk)`
  - [x] 2.2 Export it for TypeScript access via `pureCircuits.relayCommitment()`
- [x] Task 3: Add `setEmailPublicKey` circuit (AC: 2)
  - [x] 3.1 Owner-only: `assert(owner == ownerCommitment(local_secret_key()), "Not the vault owner")`
  - [x] 3.2 `disclose(pubKey)` before ledger assignment
  - [x] 3.3 Assign `emailPublicKey = key`
- [x] Task 4: Add `setMailRelay` circuit (AC: 4)
  - [x] 4.1 Owner-only guard (same ownerCommitment check)
  - [x] 4.2 `disclose(relayCommit)` before ledger assignment
  - [x] 4.3 Assign `mailRelay = relay`
- [x] Task 5: Add `notifyNewMail` circuit (AC: 5, 7)
  - [x] 5.1 Relay-only: `assert(mailRelay == relayCommitment(local_relay_key()), "Not authorized relay")`
  - [x] 5.2 `disclose(manifestCid)` before ledger assignment
  - [x] 5.3 `emailCount.increment(1)` and `inboxManifestCid = cid`
- [x] Task 6: Update TypeScript witnesses (AC: 7)
  - [x] 6.1 Add `relayKey: Uint8Array` to `VaultRegistryPrivateState` type in `witnesses.ts`
  - [x] 6.2 Update `createVaultRegistryPrivateState()` to accept optional `relayKey` parameter (default: `new Uint8Array(32)`)
  - [x] 6.3 Add `local_relay_key` witness implementation: `[privateState, privateState.relayKey]`
- [x] Task 7: Update VaultRegistrySimulator (AC: 9, 10)
  - [x] 7.1 Add `relayKey` parameter to constructor
  - [x] 7.2 Add `setEmailPublicKey(pubKey)`, `setMailRelay(relayCommit)`, `notifyNewMail(manifestCid)` wrapper methods
  - [x] 7.3 Add `static relayCommitment(rk)` pure circuit wrapper
- [x] Task 8: Write contract unit tests (AC: 9, 10)
  - [x] 8.1 `setEmailPublicKey`: owner can set, non-owner rejected, overwrite works, default init
  - [x] 8.2 `setMailRelay`: owner can set, non-owner rejected, overwrite works
  - [x] 8.3 `notifyNewMail`: authorized relay can call, unauthorized rejected, emailCount increments, inboxManifestCid updates, fails if no relay set
  - [x] 8.4 `relayCommitment`: deterministic, different from ownerCommitment/backupCommitment for same key, different for different keys
  - [x] 8.5 Existing tests: verify all previous tests still pass (zero regressions)
- [x] Task 9: Compile contract and verify generated TypeScript (AC: all)
  - [x] 9.1 Run `compact compile` to compile updated contract
  - [x] 9.2 Verify generated `managed/vault-registry/contract/index.js` exports new circuits
  - [x] 9.3 Verify `Ledger` type includes new fields (`emailPublicKey`, `emailCount`, `inboxManifestCid`, `mailRelay`)
- [x] Task 10: Update contract header comment and access control matrix (AC: all)
  - [x] 10.1 Add `setEmailPublicKey`, `setMailRelay`, `notifyNewMail` to the function list
  - [x] 10.2 Add relay-only row to access control matrix
  - [x] 10.3 Add new state variables to STATE VARIABLES section
  - [x] 10.4 Add `local_relay_key` to WITNESSES section
  - [x] 10.5 Remove `getPublicKey` and `notifyNewMail` from PLANNED section (now implemented)

## Dev Notes

### Architecture: What This Story Does and Does NOT Do

**In scope:** Compact contract changes + TypeScript witness/simulator/test updates. All changes are in `packages/blockchain/contract/`.

**Out of scope:** X25519 keypair generation in browser extension (that's the consumer side — will be needed in Story 5.2 when the UI calls `setEmailPublicKey`). VaultJson format changes are also deferred to the story that first generates and stores the keypair (5.2). This story is purely the on-chain foundation.

### Contract Source Files

| File | Action | Purpose |
|------|--------|---------|
| `packages/blockchain/contract/src/vault-registry.compact` | **Edit** | Add 4 ledger vars, 1 witness, 3 circuits, 1 pure circuit |
| `packages/blockchain/contract/src/witnesses.ts` | **Edit** | Add `relayKey` to private state, add `local_relay_key` witness |
| `packages/blockchain/contract/src/test/vault-registry-simulator.ts` | **Edit** | Add constructor param, 3 wrapper methods, 1 static method |
| `packages/blockchain/contract/src/test/vault-registry.test.ts` | **Edit** | Add ~15 new tests in new `describe` blocks |
| `packages/blockchain/contract/src/managed/vault-registry/contract/index.js` | **Auto-generated** | Recompile after `.compact` changes |

### Compact Code to Add

```compact
// ── Email & Relay (Story 5.0 — ADR-008, ADR-009) ──────────────────────

// Public ledger: X25519 public key for email encryption (32 bytes)
export ledger emailPublicKey: Bytes<32>;

// Public ledger: count of email notifications (extension watches for changes)
export ledger emailCount: Counter;

// Public ledger: IPFS CID of the inbox manifest (latest pointer)
export ledger inboxManifestCid: Opaque<'string'>;

// Public ledger: authorized mail relay commitment
export ledger mailRelay: Bytes<32>;

// Witness: returns the relay's secret key from private state
witness local_relay_key(): Bytes<32>;

// Derive a relay commitment from a relay key.
// Uses domain separator "vault:relay:" — different from "vault:owner:" and "vault:backup:".
export circuit relayCommitment(rk: Bytes<32>): Bytes<32> {
  return persistentCommit<Bytes<32>>(pad(32, "vault:relay:"), rk);
}

// Owner-only: store X25519 public key for email encryption.
export circuit setEmailPublicKey(pubKey: Bytes<32>): [] {
  const key = disclose(pubKey);
  const sk = local_secret_key();
  assert(owner == ownerCommitment(sk), "Not the vault owner");
  emailPublicKey = key;
}

// Owner-only: authorize a mail relay to call notifyNewMail.
export circuit setMailRelay(relayCommit: Bytes<32>): [] {
  const relay = disclose(relayCommit);
  const sk = local_secret_key();
  assert(owner == ownerCommitment(sk), "Not the vault owner");
  mailRelay = relay;
}

// Relay-only: update inbox manifest CID and increment email counter.
// Only the authorized relay (verified via relayCommitment) can call this.
export circuit notifyNewMail(manifestCid: Opaque<'string'>): [] {
  const cid = disclose(manifestCid);
  const rk = local_relay_key();
  assert(mailRelay == relayCommitment(rk), "Not authorized relay");
  emailCount.increment(1);
  inboxManifestCid = cid;
}
```

### Witness Changes (`witnesses.ts`)

```typescript
// BEFORE
export type VaultRegistryPrivateState = {
  readonly secretKey: Uint8Array;
  readonly backupKey: Uint8Array;
};

export const createVaultRegistryPrivateState = (
  secretKey: Uint8Array,
  backupKey?: Uint8Array,
): VaultRegistryPrivateState => ({
  secretKey,
  backupKey: backupKey ?? new Uint8Array(32),
});

// AFTER — add relayKey
export type VaultRegistryPrivateState = {
  readonly secretKey: Uint8Array;
  readonly backupKey: Uint8Array;
  readonly relayKey: Uint8Array;
};

export const createVaultRegistryPrivateState = (
  secretKey: Uint8Array,
  backupKey?: Uint8Array,
  relayKey?: Uint8Array,
): VaultRegistryPrivateState => ({
  secretKey,
  backupKey: backupKey ?? new Uint8Array(32),
  relayKey: relayKey ?? new Uint8Array(32),
});

// Add to vaultRegistryWitnesses:
export const vaultRegistryWitnesses = {
  local_secret_key: ({ privateState }: WitnessContext<Ledger, VaultRegistryPrivateState>):
    [VaultRegistryPrivateState, Uint8Array] => [privateState, privateState.secretKey],
  local_backup_key: ({ privateState }: WitnessContext<Ledger, VaultRegistryPrivateState>):
    [VaultRegistryPrivateState, Uint8Array] => [privateState, privateState.backupKey],
  local_relay_key: ({ privateState }: WitnessContext<Ledger, VaultRegistryPrivateState>):
    [VaultRegistryPrivateState, Uint8Array] => [privateState, privateState.relayKey],
};
```

### Simulator Changes

Add to `VaultRegistrySimulator`:
- Constructor: `constructor(secretKey, backupKey?, relayKey?)` — pass `relayKey` to `createVaultRegistryPrivateState`
- New methods: `setEmailPublicKey(pubKey)`, `setMailRelay(relayCommit)`, `notifyNewMail(manifestCid)` — same `impureCircuits.*` + context update pattern as existing methods
- Static: `relayCommitment(rk)` → `pureCircuits.relayCommitment(rk)`

**Note on `notifyNewMail` manifestCid parameter type:** `Opaque<'string'>` maps to `string` in the generated TypeScript API. The simulator wrapper should accept `string` and the runtime handles the encoding. Verify against the generated `index.js` after compilation — look at how `bboard.post(new_message: Opaque<"string">)` maps to `post(new_message: string)` in the bboard example.

### Test Plan

New tests (~15) organized in 4 `describe` blocks:

```
describe("setEmailPublicKey")
  - owner can set email public key
  - non-owner cannot set email public key
  - owner can overwrite email public key
  - initializes to default<Bytes<32>> before any set

describe("setMailRelay")
  - owner can set mail relay commitment
  - non-owner cannot set mail relay commitment
  - owner can overwrite mail relay (re-authorization)

describe("notifyNewMail")
  - authorized relay can call notifyNewMail
  - unauthorized caller cannot call notifyNewMail (wrong relay key)
  - emailCount increments on each call
  - inboxManifestCid updates to latest value
  - fails if no relay is set (mailRelay == default)

describe("relayCommitment (pure circuit)")
  - produces deterministic output for same key
  - produces different commitment than ownerCommitment for same key
  - produces different commitment than backupCommitment for same key
  - produces different commitments for different keys
```

**Test helpers:** Reuse existing `createRegisteredOwner()`, `createAttackerContext()`, `makeSecretKey()`. Add `createRelayContext()` helper that:
1. Creates an owner simulator, registers vault
2. Creates a relay simulator with a relay key
3. Owner calls `setMailRelay(relayCommitment(relayKey))`
4. Injects relay's private state into owner's contract state (same cross-instance pattern as `createAttackerContext`)

**For notifyNewMail `manifestCid` parameter:** Use a test string like `"bafyreifake123"`. The `Opaque<'string'>` type accepts any string — no CID validation at the contract level (validation happens in the SMTP bridge TypeScript code).

### Compact Language Constraints Checklist

Per project-context Rule 10 — verify before writing:

- [x] `pragma language_version >= 0.20;` — already present
- [x] `disclose()` on all circuit parameters before ledger/conditional use
- [x] `persistentCommit<Bytes<32>>(pad(32, "vault:relay:"), rk)` — correct signature
- [x] `pad(32, "vault:relay:")` — correct string-to-Bytes conversion
- [x] Return type `): []` not `): Void`
- [x] `Counter.increment(1)` — confirmed across 8+ reference projects
- [x] `Opaque<'string'>` — confirmed in bboard, composable-inner, election examples
- [x] No `currentTimestamp()` needed (email circuits don't use time)
- [x] `default<Bytes<32>>` not `default<Bytes<32>>()` — expression, not function

### Midnight SDK Reference Cross-Check (Rule 18)

| Pattern | Reference Projects | Our Usage |
|---------|-------------------|-----------|
| `persistentCommit` for authorization | bboard, composable-inner (authority check), micro-dao, coracle, midnames | `relayCommitment(rk)` — identical pattern |
| Multiple witnesses in one contract | midnames (`local_secret_key` + `multiple_local_secret_keys`), midnight-bank (6+ witnesses) | `local_secret_key` + `local_backup_key` + `local_relay_key` |
| `Opaque<'string'>` ledger variable | bboard (`message`), composable-inner (`value`), election (`topic`), compact test suite | `inboxManifestCid: Opaque<'string'>` |
| `Counter` ledger variable | counter example (all variants), bboard (`instance`), election (`tally_yes`, `tally_no`), compact test suite | `emailCount: Counter` |
| `disclose()` before `Opaque` assignment | bboard: `message = some<Opaque<"string">>(disclose(new_message))` | `inboxManifestCid = cid` after `const cid = disclose(manifestCid)` |
| Cross-instance context injection (tests) | Our own `createAttackerContext` pattern | `createRelayContext` uses same injection for relay key |

### Key Risk: `Opaque<'string'>` Initialization

The `Opaque<'string'>` type's default value after contract deployment needs verification. In the bboard example, `message` is initialized as `none<Opaque<"string">>()` using `Maybe`. Our `inboxManifestCid` is a bare `Opaque<'string'>` — its default may be an empty string `""` or a null representation. The extension should handle the case where `inboxManifestCid` is empty/default (no emails yet). Verify this in tests by reading the initial ledger state before any `notifyNewMail` call.

### Previous Story Intelligence

**From Story 4.3 (most recent):**
- Callback pattern for crypto: shared packages accept encrypt/decrypt callbacks rather than importing browser-specific utilities → Relevant for future stories, not this one (pure contract story)
- Rule 24: Updated `externals.d.ts` ambient declarations when exporting new types → Not needed here (contract package is in `packages/*` workspace, not browser extension)
- Test approach: 8 unit tests with mocked providers + `tsc --noEmit` for wiring verification

**From Story 4.2:**
- Test helper pattern: Construct complex test objects with helper functions → Apply to relay test setup
- 22 unit tests covering merge scenarios → Similar thoroughness expected here (~15 tests)

### Compilation & Build

```bash
cd packages/blockchain/contract
# Compile the updated Compact contract
npx compactc src/vault-registry.compact --output src/managed/vault-registry

# Run tests
pnpm test

# Verify generated types include new fields
# Check: src/managed/vault-registry/contract/index.js
# - Ledger type should have: emailPublicKey, emailCount, inboxManifestCid, mailRelay
# - impureCircuits should have: setEmailPublicKey, setMailRelay, notifyNewMail
# - pureCircuits should have: relayCommitment (+ existing ownerCommitment, backupCommitment)
```

### Project Structure Notes

- All changes are within `packages/blockchain/contract/` — no cross-package changes
- No browser extension changes needed (this is pure on-chain infrastructure)
- No `externals.d.ts` update needed (contract package is in pnpm workspace)
- The `vault-registry-types.ts` in `packages/blockchain/cli/` may need `relayKey` added to the providers type if/when the CLI API wraps these circuits (defer to Story 5.2/5.3)

### References

- [ADR-008: X25519 Hybrid Encryption](docs/architecture/adr-008-email-encryption-x25519.md) — keypair design, `setEmailPublicKey` circuit pseudocode
- [ADR-009: On-Chain Email Notification](docs/architecture/adr-009-email-notification-on-chain.md) — relay pattern, `notifyNewMail` circuit pseudocode, authorization table
- [VaultRegistry Contract](packages/blockchain/contract/src/vault-registry.compact) — existing commitment patterns
- [Witnesses](packages/blockchain/contract/src/witnesses.ts) — private state type, witness implementations
- [Simulator](packages/blockchain/contract/src/test/vault-registry-simulator.ts) — test pattern
- [Tests](packages/blockchain/contract/src/test/vault-registry.test.ts) — existing test structure
- [Project Context Rule 9](project-context.md#9) — `persistentCommit` for ownership
- [Project Context Rule 10](project-context.md#10) — Compact language gotchas
- [Project Context Rule 11](project-context.md#11) — Contract unit testing pattern
- [Project Context Rule 14](project-context.md#14) — ADT operations, domain separators

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Compact compiler: `pnpm run compact:vault-registry` — compiled 11 circuits (was 7, now 11 with relayCommitment, setEmailPublicKey, setMailRelay, notifyNewMail)
- `npx compactc` is not a valid command — use `compact compile` via package.json script
- `Opaque<'string'>` maps to `string` in generated TypeScript API (confirmed in generated index.js)

### Completion Notes List

- Task 1-5: Added 4 ledger variables (`emailPublicKey`, `emailCount`, `inboxManifestCid`, `mailRelay`), 1 witness (`local_relay_key`), 1 pure circuit (`relayCommitment`), 3 impure circuits (`setEmailPublicKey`, `setMailRelay`, `notifyNewMail`) to vault-registry.compact
- Task 6: Extended `VaultRegistryPrivateState` with `relayKey` field, added `local_relay_key` witness to `vaultRegistryWitnesses`
- Task 7: Extended `VaultRegistrySimulator` constructor with `relayKey` param, added 3 wrapper methods + 1 static method
- Task 8: 16 new unit tests across 4 describe blocks. `createRelayContext()` helper follows same cross-instance injection pattern as `createAttackerContext()`. Total: 49 vault-registry tests (45 pass + 4 pre-existing blockTimeGte skips)
- Task 9: Contract compiled successfully, generated TypeScript verified — Ledger type has all 4 new fields, impureCircuits has 3 new methods, pureCircuits has relayCommitment
- Task 10: Updated header comment, function list, access control matrix (added relay-only row), state variables, witnesses, removed implemented items from PLANNED section
- All 80 tests pass (3 test files), 6 skipped (pre-existing blockTimeGte stubs), zero regressions

### File List

- `packages/blockchain/contract/src/vault-registry.compact` — modified (4 ledger vars, 1 witness, 4 circuits, updated header/matrix, email state reset in transferOwnership/backupTransfer)
- `packages/blockchain/contract/src/witnesses.ts` — modified (relayKey in type + factory + witness)
- `packages/blockchain/contract/src/test/vault-registry-simulator.ts` — modified (constructor, 3 methods, 1 static)
- `packages/blockchain/contract/src/test/vault-registry.test.ts` — modified (createRelayContext helper, 18 new tests)
- `packages/blockchain/contract/src/managed/vault-registry/contract/index.js` — auto-generated (recompiled)
- `packages/blockchain/contract/src/managed/vault-registry/contract/index.d.ts` — auto-generated (recompiled)
- `packages/blockchain/contract/src/managed/vault-registry/contract/index.js.map` — auto-generated (recompiled)
- `packages/blockchain/contract/src/managed/vault-registry/compiler/contract-info.json` — auto-generated (recompiled)
- `packages/blockchain/contract/src/managed/vault-registry/keys/{setEmailPublicKey,setMailRelay,notifyNewMail}.{prover,verifier}` — auto-generated (new, 6 files)
- `packages/blockchain/contract/src/managed/vault-registry/zkir/{setEmailPublicKey,setMailRelay,notifyNewMail}.{bzkir,zkir}` — auto-generated (new, 6 files)
- `_bmad-output/project-context.md` — modified (Rules 11, 14, 15 updated with relay commitment pattern)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — modified (5-0 status: in-progress -> review)
- `_bmad-output/implementation-artifacts/5-0-email-keypair-relay-authorization.md` — modified (this file)

### Change Log

- 2026-03-05: Story 5.0 implemented — Email keypair & relay authorization on-chain foundation (all 10 tasks, 16 new tests, zero regressions)
