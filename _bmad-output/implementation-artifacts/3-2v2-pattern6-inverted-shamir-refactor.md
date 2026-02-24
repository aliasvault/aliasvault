# Story 3.2v2: Pattern 6 Inverted Shamir Refactor (ADR-007)

Status: review

## Story

As a user setting up guardians,
I want my Master Password encrypted with an ephemeral key derived from a Shamir secret (not stored anywhere),
so that recovery works cross-device without relying on device-local state or vault blob storage.

## Acceptance Criteria

1. Generate ephemeral Shamir secret (32 bytes, random) — NEVER stored
2. Derive encryption key via domain-separated hash: `SHA-256("aliasvault:rk:" + hex(shamirSecret))`
3. Encrypt `MasterPassword` with derived key (AES-256-GCM) → `EncryptedPassword`
4. Shamir-split the **secret** (NOT the encrypted password) into 3 shares (2-of-3 threshold)
5. Encrypt each share with respective Guardian's RSA public key (RSA-OAEP-SHA256)
6. Bundle `EncryptedPassword` + encrypted shares into single IPFS package (version 2 format)
7. Store `SHA-256(hex(shamirSecret))` on-chain via `VaultRegistry.storeRecoveryKeyHash()` for verification
8. Remove `persistRecoveryKey()` from `RecoveryPersistProvider` interface — recovery key is ephemeral
9. All existing tests updated + new tests for `deriveEncryptionKey` and v2 roundtrip
10. Full roundtrip test validates: setup → decrypt 2-of-3 shares → Shamir combine → verify hash → derive key → decrypt password

## Tasks / Subtasks

- [x] Task 1: Add `deriveEncryptionKey` to recovery-crypto.ts (AC: #2)
  - [x] 1.1 Add `deriveEncryptionKey(shamirSecret: Uint8Array): Promise<Uint8Array>` — returns `sha256('aliasvault:rk:' + bytesToHex(shamirSecret))`
  - [x] 1.2 Export from `shared/vault-sync/src/index.ts`

- [x] Task 2: Refactor recovery-setup.ts to v2 flow (AC: #1-#7)
  - [x] 2.1 Update `GuardianSharePackage` interface:
    - Change `version: 1` → `version: 2`
    - Add `encryptedPassword: string` field (base64 of AES-256-GCM encrypted master password)
  - [x] 2.2 Update `SetupResult` interface:
    - **Remove** `recoveryKey: Uint8Array` — recovery key is ephemeral, never returned
    - Keep `recoveryKeyHash: Uint8Array` (SHA-256 of shamirSecret hex)
    - Keep `sharePackage: GuardianSharePackage`
  - [x] 2.3 Rewrite `setupGuardianRecovery()` flow:
    1. `generateRecoveryKey()` → shamirSecret (32 random bytes — same function, different semantic)
    2. `deriveEncryptionKey(shamirSecret)` → encryptionKey (domain-separated SHA-256)
    3. `encryptWithRecoveryKey(masterPassword, encryptionKey)` → encryptedPassword
    4. `splitIntoShares(bytesToHex(shamirSecret), 3, 2)` → 3 shares (**split the SECRET, not encrypted password**)
    5. For each share: `encryptShareForGuardian(share, guardianPublicKeys[i])`
    6. `sha256(bytesToHex(shamirSecret))` → recoveryKeyHash
    7. Package: `{ version: 2, encryptedPassword: base64(encryptedPassword), shares, ... }`
    8. Return `{ recoveryKeyHash, sharePackage }` — shamirSecret + encryptionKey DISCARDED

- [x] Task 3: Refactor recovery-persist.ts to v2 (AC: #8)
  - [x] 3.1 Remove `persistRecoveryKey(recoveryKey: Uint8Array): Promise<void>` from `RecoveryPersistProvider` interface
  - [x] 3.2 Remove step 7 (`provider.persistRecoveryKey(setupResult.recoveryKey)`) from `persistGuardianRecovery()`
  - [x] 3.3 Update JSDoc to reflect v2 (5 steps → 4 steps)

- [x] Task 4: Add test for `deriveEncryptionKey` in recovery-crypto.test.ts (AC: #2, #9)
  - [x] 4.1 Test `deriveEncryptionKey()` returns 32-byte Uint8Array
  - [x] 4.2 Test `deriveEncryptionKey()` is deterministic — same input → same output
  - [x] 4.3 Test `deriveEncryptionKey()` is domain-separated — different from plain `sha256(hex(secret))`

- [x] Task 5: Refactor recovery-setup.test.ts to v2 (AC: #1-#7, #9, #10)
  - [x] 5.1 Update structure test: `SetupResult` has NO `recoveryKey`, has `recoveryKeyHash` (32 bytes) and `sharePackage`
  - [x] 5.2 Update metadata test: `version` is 2, `threshold` is 2, `totalShares` is 3, `encryptedPassword` is a non-empty string
  - [x] 5.3 Rewrite full roundtrip test — v2 recovery flow:
    1. Call `setupGuardianRecovery()` → get `{ recoveryKeyHash, sharePackage }`
    2. Decrypt 2 shares with guardian private keys → 2 share hex strings
    3. `combineShares([share0, share1])` → `shamirSecretHex`
    4. Verify `sha256(shamirSecretHex)` matches `recoveryKeyHash` (integrity check)
    5. `deriveEncryptionKey(hexToUint8Array(shamirSecretHex))` → encryptionKey
    6. `base64ToUint8Array(sharePackage.encryptedPassword)` → encryptedPassword bytes
    7. `decryptWithRecoveryKey(encryptedPassword, encryptionKey)` → original master password
  - [x] 5.4 Update `recoveryKeyHash` verification — hash of shamirSecret hex, verified via roundtrip (no direct access to ephemeral secret)
  - [x] 5.5 Keep validation tests unchanged (empty password, wrong guardian count, empty ownerCommitment)

- [x] Task 6: Refactor recovery-persist.test.ts to v2 (AC: #8, #9)
  - [x] 6.1 Remove `persistRecoveryKey` from `createMockProvider()` — only 3 methods now
  - [x] 6.2 Update call order test: expect `['uploadToIpfs', 'storeSharesCidHash', 'storeRecoveryKeyHash']` — 3 calls, not 4
  - [x] 6.3 Update `createMockSetupResult()`: remove `recoveryKey`, set version to 2, add `encryptedPassword` field
  - [x] 6.4 Update IPFS upload JSON test: expect `version: 2` and `encryptedPassword` field present

- [x] Task 7: Update index.ts exports (AC: all)
  - [x] 7.1 Add `deriveEncryptionKey` to recovery-crypto exports
  - [x] 7.2 Verify `SetupResult` type export reflects v2 (no `recoveryKey`)

- [x] Task 8: Build and verify (AC: all)
  - [x] 8.1 Build: `cd shared/vault-sync && pnpm build` — zero TypeScript errors
  - [x] 8.2 Test: `cd shared/vault-sync && npx vitest run` — all tests pass (63)
  - [x] 8.3 Regression: `cd packages/blockchain/contract && npx vitest run` — no regressions (69 pass, 3 skip)
  - [x] 8.4 Regression: `cd packages/blockchain/cli && npx vitest run` — no regressions (41 pass)

## Dev Notes

### This is a REFACTOR — Not a Rewrite

Story 3.2 v1 code is solid. The crypto primitives (`encryptWithRecoveryKey`, `decryptWithRecoveryKey`, `splitIntoShares`, `combineShares`, RSA-OAEP functions) are **unchanged**. This refactor changes:

1. **What gets Shamir-split** — v1: encrypted password hex → v2: shamirSecret hex
2. **Where encrypted password lives** — v1: reconstructed from Shamir shares → v2: bundled in IPFS package
3. **Whether recovery key is returned** — v1: returned + persisted to vault blob → v2: ephemeral, discarded
4. **New function** — `deriveEncryptionKey()` for domain-separated key derivation
5. **Package format** — v1: shares only → v2: shares + encryptedPassword

### Architecture Compliance (CRITICAL)

**ADR-007 (Pattern 6 v2 — Inverted Shamir):** Recovery key is ephemeral — derived from Shamir secret, never stored anywhere. Eliminates circular dependency (vault blob encrypted with lost master password) and ADR-006 private state device-local limitation.

**Key flow change:**
```
v1: recoveryKey → encrypt(password) → split(encryptedPassword) → shares to IPFS
                                                                    recoveryKey to vault blob

v2: shamirSecret → derive(key) → encrypt(password) → password to IPFS package
                 → split(shamirSecret) → shares to IPFS package
                 → hash(shamirSecret) → on-chain verification
                   shamirSecret DISCARDED
```

### What Changes (Exact Diff)

**`recovery-crypto.ts`** — ADD 1 function:
```typescript
// NEW: Domain-separated key derivation
export async function deriveEncryptionKey(shamirSecret: Uint8Array): Promise<Uint8Array> {
  return sha256('aliasvault:rk:' + bytesToHex(shamirSecret));
}
```
All existing functions UNCHANGED.

**`recovery-setup.ts`** — MODIFY interfaces + flow:
```typescript
// GuardianSharePackage v2 — add encryptedPassword, bump version
interface GuardianSharePackage {
  version: 2;  // was 1
  vaultOwnerCommitment: string;
  threshold: number;
  totalShares: number;
  encryptedPassword: string;  // NEW: base64 of AES-GCM encrypted password
  shares: Array<{ index: number; encryptedShare: string }>;
}

// SetupResult v2 — remove recoveryKey
interface SetupResult {
  // recoveryKey: Uint8Array;  ← REMOVED (ephemeral)
  recoveryKeyHash: Uint8Array;
  sharePackage: GuardianSharePackage;
}
```

**`recovery-persist.ts`** — REMOVE 1 method from interface:
```typescript
interface RecoveryPersistProvider {
  uploadToIpfs(data: Uint8Array): Promise<string>;
  storeSharesCidHash(cidHash: Uint8Array): Promise<void>;
  storeRecoveryKeyHash(keyHash: Uint8Array): Promise<void>;
  // persistRecoveryKey ← REMOVED (ADR-007: ephemeral)
}
```
Remove `provider.persistRecoveryKey()` call from `persistGuardianRecovery()`.

### What NOT to Change

- **DO NOT** rename `generateRecoveryKey()` → it still generates 32 random bytes; semantic name change isn't worth the churn
- **DO NOT** rename `encryptWithRecoveryKey()` / `decryptWithRecoveryKey()` → still AES-256-GCM with a key parameter
- **DO NOT** modify `recovery-crypto.ts` existing functions — only add `deriveEncryptionKey()`
- **DO NOT** change the RSA-OAEP binary encoding with odd-length flag — shares are now shamirSecret shares (similar hex format)
- **DO NOT** touch contract code (`*.compact` files) — no changes needed for v2
- **DO NOT** modify `utils.ts` — `sha256`, `bytesToHex`, etc. are unchanged

### What EXISTS — Reuse These

| Component | Location | Usage |
|-----------|----------|-------|
| `sha256()` | `shared/vault-sync/src/utils.ts` | Domain-separated key derivation + hash for on-chain |
| `bytesToHex()` | `shared/vault-sync/src/utils.ts` | Hex encoding shamirSecret for Shamir input |
| `uint8ArrayToBase64()` | `shared/vault-sync/src/utils.ts` | Base64 encoding encrypted password for package |
| `encryptWithRecoveryKey()` | `recovery-crypto.ts` | AES-256-GCM encryption (unchanged) |
| `splitIntoShares()` | `recovery-crypto.ts` | Shamir splitting (unchanged — different input) |
| `encryptShareForGuardian()` | `recovery-crypto.ts` | RSA-OAEP per-guardian encryption (unchanged) |
| `assertCIDv1()` | `@aliasvault/contract` | CID validation in persist flow (unchanged) |

### Shamir Share Size Change

v1 split the encrypted password hex (~312 chars for 128-char password), producing shares of similar length.
v2 splits the shamirSecret hex (64 chars — 32 bytes as hex), producing much shorter shares (~66 chars).

This is well within RSA-OAEP's 190-byte binary payload limit. The binary encoding with odd-length flag still works correctly — just with smaller payloads.

### Test Roundtrip Flow (v2)

The full roundtrip test validates the complete recovery path:

```typescript
// SETUP
const result = await setupGuardianRecovery({ masterPassword, guardianPublicKeys, ownerCommitment });
// result has: { recoveryKeyHash, sharePackage } — NO recoveryKey

// RECOVERY SIMULATION
const share0 = await decryptShareFromGuardian(base64ToUint8Array(result.sharePackage.shares[0].encryptedShare), keys[0].privateKey);
const share1 = await decryptShareFromGuardian(base64ToUint8Array(result.sharePackage.shares[1].encryptedShare), keys[1].privateKey);
const shamirSecretHex = combineShares([share0, share1]);

// VERIFY on-chain hash
const hashCheck = await sha256(shamirSecretHex);
expect(bytesToHex(hashCheck)).toBe(bytesToHex(result.recoveryKeyHash));

// DERIVE key and decrypt
const encryptionKey = await deriveEncryptionKey(hexToUint8Array(shamirSecretHex));
const encryptedPassword = base64ToUint8Array(result.sharePackage.encryptedPassword);
const recovered = await decryptWithRecoveryKey(encryptedPassword, encryptionKey);
expect(recovered).toBe(masterPassword);
```

### Previous Story Learnings (Story 3.2 v1)

- **Odd-length hex handling:** Shamir shares from `secrets.js-34r7h` can have odd-length hex strings. The 1-byte flag prefix in `encryptShareForGuardian` handles this. v2 shares are shorter but same format.
- **`BufferSource` cast:** All `crypto.subtle` calls need `as BufferSource` in TS5+ strict mode.
- **`secrets.js-34r7h` version:** 2.0.2 (not 2.1.0). Already in `package.json`.
- **No new dependencies needed.** This refactor only changes orchestration logic.

### Package Structure (files touched)

```
shared/vault-sync/src/
├── recovery-crypto.ts          # ADD: deriveEncryptionKey()
├── recovery-setup.ts           # MODIFY: v2 flow, interfaces, setup function
├── recovery-persist.ts         # MODIFY: remove persistRecoveryKey from interface
├── recovery-crypto.test.ts     # ADD: deriveEncryptionKey tests
├── recovery-setup.test.ts      # MODIFY: v2 roundtrip, structure, metadata tests
├── recovery-persist.test.ts    # MODIFY: remove persistRecoveryKey from mocks
├── index.ts                    # MODIFY: add deriveEncryptionKey export
├── utils.ts                    # UNCHANGED
└── secrets-types.d.ts          # UNCHANGED
```

### Build Commands

```bash
# Build
cd shared/vault-sync && pnpm build

# Run tests
cd shared/vault-sync && npx vitest run

# Regression check
cd packages/blockchain/contract && npx vitest run
cd packages/blockchain/cli && npx vitest run
```

### Cross-Story Context

| Story | Relationship |
|-------|-------------|
| 3.2 (Original) | **Done.** v1 code being refactored. Crypto primitives reused as-is. |
| 3.3 (Guardian Portal) | **Backlog.** Will use v2 `setupGuardianRecovery()`. No `persistRecoveryKey` needed. |
| 3.4 (Recovery Claim) | **Backlog.** v2 ACs already written for this refactor. Recovery path: decrypt shares → combine → verify hash → derive key → decrypt password from IPFS package. |
| 2.6 (VaultRegistry) | **Done.** `storeRecoveryKeyHash()` circuit unchanged — works with v2. |

### References

- [Source: _bmad-output/architecture.md#Pattern-6] — Guardian Share Encryption (Inverted Shamir v2) pseudocode
- [Source: _bmad-output/architecture.md#Section-4] — ADR-007 rationale and sources
- [Source: _bmad-output/project-context.md#Rule-1] — Inverted Shamir Recovery (Pattern 6 v2, ADR-007)
- [Source: _bmad-output/project-context.md#Rule-16] — Shamir & RSA-OAEP implementation patterns (v2 note)
- [Source: _bmad-output/implementation-artifacts/3-2-shamir-secret-splitting-pattern-6.md] — v1 story file (all learnings)
- [Source: shared/vault-sync/src/recovery-crypto.ts] — Current v1 crypto functions
- [Source: shared/vault-sync/src/recovery-setup.ts] — Current v1 setup orchestration
- [Source: shared/vault-sync/src/recovery-persist.ts] — Current v1 persistence interface

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- Build: zero TS errors
- vault-sync tests: 63 pass (18 crypto + 7 setup + 6 persist + 32 VaultSync)
- contract regression: 69 pass, 3 skip (blockTimeGte simulator limitation)
- cli regression: 41 pass (16 deploy + 12 guardian + 13 vault)

### Completion Notes List
- Task 1: Added `deriveEncryptionKey()` to recovery-crypto.ts — domain-separated SHA-256 key derivation from Shamir secret. Exported via index.ts.
- Task 2: Refactored recovery-setup.ts to v2 inverted Shamir flow. `GuardianSharePackage` bumped to version 2 with `encryptedPassword` field. `SetupResult` no longer returns `recoveryKey` (ephemeral). `setupGuardianRecovery()` now splits the Shamir secret (not encrypted password) and bundles encrypted password in IPFS package.
- Task 3: Removed `persistRecoveryKey` from `RecoveryPersistProvider` interface and removed its call from `persistGuardianRecovery()`. Updated JSDoc to reflect 4-step flow.
- Task 4: Added 3 tests for `deriveEncryptionKey`: returns 32-byte array, deterministic, domain-separated from plain SHA-256.
- Task 5: Rewrote recovery-setup.test.ts for v2. Structure test validates no `recoveryKey` in result. Metadata test validates version 2 + `encryptedPassword` present. Full roundtrip test validates: setup → decrypt 2-of-3 shares → Shamir combine → verify hash → derive key → decrypt password. Added `recoveryKeyHash` roundtrip verification via shares[0]+shares[2] pair. Kept validation tests unchanged.
- Task 6: Updated recovery-persist.test.ts. Removed `persistRecoveryKey` from mocks (3 methods). Call order test expects 3 calls. Mock setup result uses version 2 with `encryptedPassword`. IPFS upload JSON test validates v2 structure.
- Task 7: Verified exports — `deriveEncryptionKey` exported, `SetupResult` type reflects v2.
- Task 8: Build passes, all tests pass, no regressions.

### Review Follow-ups
- Zero ephemeral secrets: Added `shamirSecret.fill(0); encryptionKey.fill(0);` before return in `setupGuardianRecovery()` — prevents key material lingering in memory.
- Stale v1 comment: Updated "handles long share hex" test comment in recovery-crypto.test.ts to clarify it tests RSA-OAEP primitive capacity, not the v2 data path (v2 splits 64-char shamirSecret hex, not ~312-char encrypted password hex).
- JSDoc alignment: Updated recovery-persist.ts JSDoc from 4 steps to 6 steps, matching inline comment numbering.

### File List
- `shared/vault-sync/src/recovery-crypto.ts` — MODIFIED: added `deriveEncryptionKey()`, added `sha256` import
- `shared/vault-sync/src/recovery-setup.ts` — MODIFIED: v2 interfaces (GuardianSharePackage, SetupResult), v2 setupGuardianRecovery() flow
- `shared/vault-sync/src/recovery-persist.ts` — MODIFIED: removed `persistRecoveryKey` from interface and flow
- `shared/vault-sync/src/recovery-crypto.test.ts` — MODIFIED: added 3 deriveEncryptionKey tests
- `shared/vault-sync/src/recovery-setup.test.ts` — MODIFIED: v2 structure, metadata, roundtrip, hash verification tests
- `shared/vault-sync/src/recovery-persist.test.ts` — MODIFIED: v2 mocks, 3-call order, v2 JSON validation
- `shared/vault-sync/src/index.ts` — MODIFIED: added `deriveEncryptionKey` export

## Change Log
- 2026-02-22: Story 3.2v2 implementation complete — Pattern 6 Inverted Shamir Refactor (ADR-007). Refactored v1 recovery setup to ephemeral key architecture. 7 files modified, 3 new tests added, all existing tests updated for v2. 63 vault-sync tests pass, 0 regressions.
- 2026-02-23: Review follow-ups — zero ephemeral secrets (shamirSecret.fill(0), encryptionKey.fill(0)), updated stale v1 comment in crypto test, aligned JSDoc step numbering in recovery-persist.ts.
