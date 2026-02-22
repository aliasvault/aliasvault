# Story 3.2: Shamir Secret Splitting (Pattern 6)

Status: done

## Story

As a user setting up guardians,
I want to encrypt my Master Password with a Recovery Key, then split the Encrypted Password into shares,
so that no single guardian can access my password.

## Acceptance Criteria

1. Generate `RecoveryKey` (AES-256, 32 bytes) via Web Crypto API (`crypto.getRandomValues`)
2. Store `RecoveryKey` in encrypted vault blob (SQLite Settings table) — **NOT** in Midnight private state (ADR-006: private state is device-local)
3. Store SHA-256 hash of `RecoveryKey` on-chain via `VaultRegistry.storeRecoveryKeyHash(keyHash: Bytes<32>)` — hash-only, never the actual key
4. Encrypt `MasterPassword` with `RecoveryKey` using AES-256-GCM → `EncryptedPassword` (IV + ciphertext + authTag)
5. Split `EncryptedPassword` into 3 shares (2-of-3 threshold) using `secrets.js-34r7h`
6. Encrypt each share with respective Guardian's RSA public key (RSA-OAEP-SHA256) via Web Crypto API
7. Package all 3 encrypted shares into a single JSON blob, upload to IPFS via `IpfsService`, validate CID with `assertCIDv1()`
8. Store SHA-256 hash of shares CID on-chain via `GuardianRecovery.storeSharesCidHash(cidHash: Bytes<32>)`

## Tasks / Subtasks

- [x] Task 1: Add `secrets.js-34r7h` dependency (AC: #5)
  - [x] 1.1 Add `secrets.js-34r7h` to `shared/vault-sync/package.json` dependencies (explicit dep per Rule 13)
  - [x] 1.2 Create `shared/vault-sync/src/secrets-types.d.ts` type declarations if `@types/secrets.js-34r7h` is not available
  - [x] 1.3 Verify import works: `import * as secrets from 'secrets.js-34r7h'` — test `secrets.share()` and `secrets.combine()` in a scratch test

- [x] Task 2: Create recovery crypto module (AC: #1, #4, #5, #6)
  - [x] 2.1 Create `shared/vault-sync/src/recovery-crypto.ts` with all pure crypto functions
  - [x] 2.2 Implement `generateRecoveryKey(): Promise<Uint8Array>` — 32 bytes via `crypto.getRandomValues(new Uint8Array(32))`
  - [x] 2.3 Implement `encryptWithRecoveryKey(plaintext: string, recoveryKey: Uint8Array): Promise<Uint8Array>` — AES-256-GCM: `[iv(12) | ciphertext | authTag(16)]` packed binary format. Use Web Crypto API `crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)`
  - [x] 2.4 Implement `decryptWithRecoveryKey(encrypted: Uint8Array, recoveryKey: Uint8Array): Promise<string>` — reverse of 2.3. Extract iv (first 12 bytes), pass rest to `crypto.subtle.decrypt`. Return UTF-8 string.
  - [x] 2.5 Implement `splitIntoShares(dataHex: string, totalShares: number, threshold: number): string[]` — wrapper around `secrets.share(dataHex, totalShares, threshold)`. Input MUST be hex-encoded.
  - [x] 2.6 Implement `combineShares(shares: string[]): string` — wrapper around `secrets.combine(shares)`. Returns hex string.
  - [x] 2.7 Implement `encryptShareForGuardian(shareHex: string, guardianPublicKeyJwk: JsonWebKey): Promise<Uint8Array>` — RSA-OAEP-SHA256 encryption via Web Crypto API. Import public key as JWK, encrypt hex-encoded share bytes.
  - [x] 2.8 Implement `decryptShareFromGuardian(encryptedShare: Uint8Array, guardianPrivateKeyJwk: JsonWebKey): Promise<string>` — RSA-OAEP-SHA256 decryption. Returns hex string. (Needed by Story 3.4 but implement now for testing)
  - [x] 2.9 Implement `generateGuardianKeyPair(): Promise<{ publicKey: JsonWebKey, privateKey: JsonWebKey }>` — RSA-OAEP 2048-bit key pair via Web Crypto API. For testing and guardian key setup.
  - [x] 2.10 Export all functions from `shared/vault-sync/src/index.ts`

- [x] Task 3: Create recovery setup orchestration (AC: #1-#8)
  - [x] 3.1 Create `shared/vault-sync/src/recovery-setup.ts`
  - [x] 3.2 Define `GuardianSharePackage` type:
    ```typescript
    interface GuardianSharePackage {
      version: 1;
      vaultOwnerCommitment: string; // hex of owner commitment
      threshold: number;            // 2
      totalShares: number;          // 3
      shares: Array<{
        index: number;              // 0, 1, or 2
        encryptedShare: string;     // base64 of RSA-encrypted share
      }>;
    }
    ```
  - [x] 3.3 Implement `setupGuardianRecovery(params): Promise<SetupResult>` with params:
    ```typescript
    {
      masterPassword: string;
      guardianPublicKeys: [JsonWebKey, JsonWebKey, JsonWebKey];
      ownerCommitment: string; // hex
    }
    ```
    Returns:
    ```typescript
    {
      recoveryKey: Uint8Array;       // To store in vault blob
      recoveryKeyHash: Uint8Array;   // SHA-256 hash for on-chain storage
      sharePackage: GuardianSharePackage; // To upload to IPFS
    }
    ```
  - [x] 3.4 Implementation flow inside `setupGuardianRecovery()`:
    1. `generateRecoveryKey()` → recoveryKey (32 bytes)
    2. `sha256(bytesToHex(recoveryKey))` → recoveryKeyHash
    3. `encryptWithRecoveryKey(masterPassword, recoveryKey)` → encryptedPassword
    4. Convert encryptedPassword to hex
    5. `splitIntoShares(hex, 3, 2)` → 3 share strings
    6. For each share: `encryptShareForGuardian(share, guardianPublicKeys[i])` → encryptedShare
    7. Package into `GuardianSharePackage` JSON
    8. Return `{ recoveryKey, recoveryKeyHash, sharePackage }`
  - [x] 3.5 Export from `shared/vault-sync/src/index.ts`

- [x] Task 4: Create on-chain + IPFS persistence flow (AC: #2, #3, #7, #8)
  - [x] 4.1 Create `shared/vault-sync/src/recovery-persist.ts`
  - [x] 4.2 Define `RecoveryPersistProvider` interface:
    ```typescript
    interface RecoveryPersistProvider {
      uploadToIpfs(data: Uint8Array): Promise<string>;          // Returns CIDv1
      storeSharesCidHash(cidHash: Uint8Array): Promise<void>;   // GuardianRecovery contract
      storeRecoveryKeyHash(keyHash: Uint8Array): Promise<void>; // VaultRegistry contract
      persistRecoveryKey(recoveryKey: Uint8Array): Promise<void>; // Vault blob (SQLite)
    }
    ```
  - [x] 4.3 Implement `persistGuardianRecovery(setupResult, provider): Promise<{ sharesCid: string }>`:
    1. Serialize `sharePackage` to JSON → UTF-8 bytes
    2. `provider.uploadToIpfs(bytes)` → sharesCid
    3. `assertCIDv1(sharesCid)`
    4. `sha256(sharesCid)` → sharesCidHash
    5. `provider.storeSharesCidHash(sharesCidHash)` → on-chain
    6. `provider.storeRecoveryKeyHash(setupResult.recoveryKeyHash)` → on-chain
    7. `provider.persistRecoveryKey(setupResult.recoveryKey)` → vault blob
    8. Return `{ sharesCid }`
  - [x] 4.4 Export from `shared/vault-sync/src/index.ts`

- [x] Task 5: Unit tests for recovery crypto (AC: #1, #4, #5, #6)
  - [x] 5.1 Create `shared/vault-sync/src/recovery-crypto.test.ts`
  - [x] 5.2 Test `generateRecoveryKey()` — returns 32-byte Uint8Array, unique on each call
  - [x] 5.3 Test `encryptWithRecoveryKey` + `decryptWithRecoveryKey` roundtrip — encrypt "my-secret-password", decrypt, assert equal
  - [x] 5.4 Test `encryptWithRecoveryKey` with wrong key fails — different key → `decryptWithRecoveryKey` throws
  - [x] 5.5 Test `splitIntoShares` + `combineShares` roundtrip — split hex string into 3 shares (threshold 2), combine any 2, assert equal to original
  - [x] 5.6 Test `splitIntoShares` — verify 3 shares returned, each is non-empty string
  - [x] 5.7 Test `combineShares` with insufficient shares — 1 share cannot reconstruct (verify by checking result !== original)
  - [x] 5.8 Test `encryptShareForGuardian` + `decryptShareFromGuardian` roundtrip — generate RSA key pair, encrypt share hex, decrypt, assert equal
  - [x] 5.9 Test `encryptShareForGuardian` with wrong private key fails — different key pair → decryption throws
  - [x] 5.10 Test `generateGuardianKeyPair()` — returns valid JWK public + private keys

- [x] Task 6: Unit tests for recovery setup orchestration (AC: #1-#8)
  - [x] 6.1 Create `shared/vault-sync/src/recovery-setup.test.ts`
  - [x] 6.2 Test `setupGuardianRecovery()` returns valid structure — recoveryKey is 32 bytes, recoveryKeyHash is 32 bytes, sharePackage has 3 shares
  - [x] 6.3 Test full roundtrip: setup → decrypt any 2 shares → combine → decrypt with recovery key → assert equals original master password
  - [x] 6.4 Test `sharePackage.version` is 1, `threshold` is 2, `totalShares` is 3
  - [x] 6.5 Test `recoveryKeyHash` matches `sha256(bytesToHex(recoveryKey))`

- [x] Task 7: Unit tests for persistence flow (AC: #2, #3, #7, #8)
  - [x] 7.1 Create `shared/vault-sync/src/recovery-persist.test.ts`
  - [x] 7.2 Test `persistGuardianRecovery()` — mock provider, verify all 4 provider methods called in correct order
  - [x] 7.3 Test `persistGuardianRecovery()` — verify IPFS upload data is valid JSON with expected structure
  - [x] 7.4 Test `persistGuardianRecovery()` — verify `assertCIDv1` is called on returned CID
  - [x] 7.5 Test `persistGuardianRecovery()` — verify sharesCidHash is SHA-256 of CID string
  - [x] 7.6 Test `persistGuardianRecovery()` — verify error propagation if IPFS upload fails

- [x] Task 8: Build and verify (AC: all)
  - [x] 8.1 Run `pnpm install` from project root to resolve `secrets.js-34r7h`
  - [x] 8.2 Build shared/vault-sync: `cd shared/vault-sync && pnpm build` — verify no TypeScript errors
  - [x] 8.3 Run tests: `cd shared/vault-sync && npx vitest run` — all tests pass
  - [x] 8.4 Run existing tests in `packages/blockchain/contract/` and `packages/blockchain/cli/` — no regressions

## Dev Notes

### Architecture Compliance (CRITICAL)

**ADR-003: Shared Business Logic.** All recovery crypto functions and orchestration MUST be in `shared/vault-sync/`. The browser extension and guardian portal (Story 3.3) will import from this shared package. Do NOT put business logic in `apps/browser-extension/`.

**ADR-006: Recovery Key Storage.** The actual recovery key is stored in the encrypted vault blob (SQLite Settings table), NOT in Midnight private state. Private state is device-local and does NOT sync. Only the SHA-256 hash goes on-chain via `VaultRegistry.storeRecoveryKeyHash()`. [Source: _bmad-output/project-context.md#Rule-12]

**Pattern 6: Dual-Layer Encryption.** Three layers of protection:
1. **Layer 1:** Master password encrypted with recovery key (AES-256-GCM)
2. **Layer 2:** Encrypted password split into Shamir shares (2-of-3)
3. **Layer 3:** Each share encrypted with guardian's RSA public key (RSA-OAEP-SHA256)

Security property: Even if ALL 3 guardians collude, they cannot reconstruct the master password — they only get the encrypted version, and the recovery key is separate.

### What EXISTS — Reuse These

| Component | Location | What to Use |
|-----------|----------|-------------|
| `sha256()` | `shared/vault-sync/src/utils.ts` | Hash recovery key and CID for on-chain storage |
| `bytesToHex()` / `hexToUint8Array()` | `shared/vault-sync/src/utils.ts` | Hex encoding for Shamir (requires hex input) |
| `uint8ArrayToBase64()` / `base64ToUint8Array()` | `shared/vault-sync/src/utils.ts` | Base64 encoding for share packaging |
| `assertCIDv1()` | `packages/blockchain/contract/src/cid-utils.ts` (re-exported via `@aliasvault/contract`) | Validate IPFS CID before storing hash |
| `IpfsService.upload()` | `shared/ipfs-service/src/IpfsService.ts` | Upload share package blob to IPFS |
| `VaultRegistry.storeRecoveryKeyHash()` | `packages/blockchain/contract/src/vault-registry.compact` line ~169 | Store recovery key hash on-chain (owner-only) |
| `GuardianRecovery.storeSharesCidHash()` | `packages/blockchain/contract/src/guardian-recovery.compact` | Store shares CID hash on-chain (owner-only) |
| `EncryptionUtility.encryptWithPublicKey()` | `apps/browser-extension/src/utils/EncryptionUtility.ts` line 185 | **Reference only** — reimplement in shared using same Web Crypto pattern |
| `EncryptionKey` type | `shared/models/src/vault/EncryptionKey.ts` | Guardian key format: `{ Id, PublicKey, PrivateKey, IsPrimary }` |

### What NOT to Do (Anti-Patterns)

- **DO NOT** store recovery key in Midnight private state — it's device-local and will be lost on new device. Store in vault blob. [Source: project-context.md Rule 12]
- **DO NOT** store recovery key in `chrome.storage.local` — same problem, device-local only.
- **DO NOT** import from `apps/browser-extension/` in shared packages — violates ADR-003 dependency direction. Reimplement crypto functions using Web Crypto API.
- **DO NOT** use Node.js `crypto` module (`createCipheriv`, `createDecipheriv`) — these are NOT available in browser. Use Web Crypto API (`crypto.subtle`) exclusively for cross-platform compatibility.
- **DO NOT** split the master password directly with Shamir — encrypt it FIRST with the recovery key, THEN split the encrypted version. This is the dual-layer protection.
- **DO NOT** store individual shares on-chain — too expensive. Package all encrypted shares into one IPFS blob, store only the CID hash on-chain.
- **DO NOT** use `Buffer` — it's Node-only. Use `Uint8Array` and `TextEncoder`/`TextDecoder` for cross-platform compatibility.

### Crypto Implementation Details

**AES-256-GCM (Recovery Key Encryption):**
```typescript
// Web Crypto API pattern — browser + Node 20+ compatible
const key = await crypto.subtle.importKey('raw', recoveryKey, 'AES-GCM', false, ['encrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encodedData);
// Pack: [iv(12) | ciphertext+authTag]
// Web Crypto appends authTag to ciphertext automatically
```

**Shamir Secret Sharing (`secrets.js-34r7h`):**
```typescript
import * as secrets from 'secrets.js-34r7h';
// Input MUST be hex-encoded string
const shares = secrets.share(hexString, 3, 2); // 3 shares, threshold 2
const reconstructed = secrets.combine(shares.slice(0, 2)); // Any 2 shares
// Output is hex-encoded string
```

**RSA-OAEP (Share Encryption):**
```typescript
// Import guardian's public key from JWK
const publicKey = await crypto.subtle.importKey(
  'jwk', guardianPublicKeyJwk,
  { name: 'RSA-OAEP', hash: 'SHA-256' },
  false, ['encrypt']
);
const encrypted = await crypto.subtle.encrypt(
  { name: 'RSA-OAEP' }, publicKey, shareBytes
);
```

**RSA Key Pair Generation (for testing + guardian setup):**
```typescript
const keyPair = await crypto.subtle.generateKey(
  { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, // extractable
  ['encrypt', 'decrypt']
);
const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
```

### Recovery Key Vault Blob Storage

Store the recovery key in the SQLite Settings table (same pattern as `midnightSecretKey` from Story 2.3):
```typescript
// Persist recovery key to vault blob — syncs via IPFS
sqliteClient.execute(
  "INSERT OR REPLACE INTO Settings (Key, Value) VALUES ('recoveryKey', ?)",
  [bytesToHex(recoveryKey)]
);
```

This is NOT part of the shared package (it's platform-specific I/O). The `RecoveryPersistProvider.persistRecoveryKey()` interface abstracts this — the browser extension implements it using SQLite, the guardian portal doesn't need it.

### Guardian Public Key Exchange

This story assumes guardian RSA public keys are available as `JsonWebKey` objects. The mechanism for exchanging these keys is Story 3.3's concern (guardian portal). For testing:
- Generate test RSA key pairs with `generateGuardianKeyPair()`
- Each guardian generates their own key pair when they join via the portal

### Package Structure

```
shared/vault-sync/
├── src/
│   ├── VaultSyncService.ts         # EXISTS: unchanged
│   ├── types.ts                    # EXISTS: unchanged
│   ├── utils.ts                    # EXISTS: sha256, bytesToHex, etc. — unchanged
│   ├── recovery-crypto.ts          # NEW: pure crypto functions (Task 2)
│   ├── recovery-setup.ts           # NEW: orchestration logic (Task 3)
│   ├── recovery-persist.ts         # NEW: persistence interfaces + impl (Task 4)
│   ├── recovery-crypto.test.ts     # NEW: crypto unit tests (Task 5)
│   ├── recovery-setup.test.ts      # NEW: setup orchestration tests (Task 6)
│   ├── recovery-persist.test.ts    # NEW: persistence tests (Task 7)
│   ├── secrets-types.d.ts          # NEW: type declarations for secrets.js-34r7h (Task 1)
│   └── index.ts                    # MODIFY: add recovery exports
├── package.json                    # MODIFY: add secrets.js-34r7h dependency
└── tsconfig.json                   # EXISTS: unchanged
```

### SDK Versions (VERIFIED WORKING — from Stories 2.1-3.1)

| Component | Version |
|-----------|---------|
| Compact CLI | 0.4.0 (language >= 0.20) |
| compact-runtime | 0.14.0 |
| midnight-js | 3.0.0 |
| ledger-v7 | 7.0.0 |
| wallet-sdk | 1.0.0 |
| secrets.js-34r7h | latest (check npm) |

### Build Commands

```bash
# Install new dependency (from project root)
pnpm install

# Build shared/vault-sync
cd shared/vault-sync && pnpm build

# Run recovery tests
cd shared/vault-sync && npx vitest run

# Verify no regressions
cd packages/blockchain/contract && npx vitest run
cd packages/blockchain/cli && npx vitest run
```

### Testing Strategy

- **Unit tests (Tasks 5-7):** All crypto functions, orchestration, and persistence
- **Roundtrip tests:** Full flow: setup → extract 2 shares → decrypt → combine → decrypt with recovery key → verify equals original password
- **Edge cases:** Wrong key decryption, insufficient shares, corrupted data, empty inputs
- **Mock-based:** IPFS upload and contract calls mocked via `RecoveryPersistProvider` interface
- **No E2E in this story:** Integration with live contracts/IPFS is tested when the browser extension wires up the provider implementation

### Web Crypto API Environment Note

`crypto.subtle` is available in:
- Browser (all modern browsers)
- Node.js 20+ (global `crypto`)
- Vitest (runs in Node, has `crypto.subtle`)

If running tests in Vitest and `crypto.subtle` is undefined, add to vitest config:
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    environment: 'node', // or 'jsdom' if DOM needed
  },
});
```

### Previous Story Learnings (from Story 3.1)

- **Domain separators are contract-specific:** VaultRegistry uses `"vault:owner:"`, GuardianRecovery uses `"recovery:owner:"`. Do not mix.
- **`storeSharesCidHash(cidHash)` already exists** in GuardianRecovery contract — owner-only circuit, tested. No contract changes needed.
- **`storeRecoveryKeyHash(keyHash)` already exists** in VaultRegistry contract — owner-only circuit, tested (Story 2.6). No contract changes needed.
- **pnpm strict hoisting (Rule 13):** When adding `secrets.js-34r7h`, add it as an explicit dependency in `shared/vault-sync/package.json`, not just at the root.
- **Simulator block time = 0:** Not relevant for this story (no time-lock logic in TypeScript).

### Cross-Story Context

| Story | Relationship |
|-------|-------------|
| 3.1 (Guardian Contract) | **Completed.** Provides `storeSharesCidHash()` circuit. No changes needed. |
| 3.3 (Guardian Portal) | **Next.** Will use `generateGuardianKeyPair()` for guardian key setup. Will call `setupGuardianRecovery()` from the owner's browser extension. |
| 3.4 (Recovery Claim) | **Future.** Will use `decryptShareFromGuardian()`, `combineShares()`, and `decryptWithRecoveryKey()` for password reconstruction. Implement those functions now so 3.4 only needs orchestration. |
| 2.6 (VaultRegistry Spec) | **Completed.** Provides `storeRecoveryKeyHash()` circuit. No changes needed. |

### References

- [Source: _bmad-output/architecture.md#Pattern-6] — Guardian Share Encryption (Dual-Layer) full pseudocode
- [Source: _bmad-output/architecture.md#4-Guardian-Recovery-Configuration] — 2-of-3 threshold decision, security properties
- [Source: _bmad-output/project-context.md#Rule-1] — Wallet-Independent Recovery Key pattern
- [Source: _bmad-output/project-context.md#Rule-2] — CIDv1 Enforcement (assertCIDv1 before storage)
- [Source: _bmad-output/project-context.md#Rule-3] — Shared Business Logic Enforcement (ADR-003)
- [Source: _bmad-output/project-context.md#Rule-12] — Midnight Private State is Device-Local (ADR-006)
- [Source: _bmad-output/project-context.md#Rule-13] — pnpm Strict Hoisting
- [Source: _bmad-output/implementation-artifacts/3-1-guardian-smart-contract.md] — Previous story file (all learnings)
- [Source: shared/vault-sync/src/utils.ts] — Existing crypto utilities (sha256, hex, base64)
- [Source: apps/browser-extension/src/utils/EncryptionUtility.ts#L185-239] — RSA-OAEP reference implementation (do NOT import, reimplement in shared)
- [Source: packages/blockchain/contract/src/vault-registry.compact#storeRecoveryKeyHash] — On-chain recovery key hash storage
- [Source: packages/blockchain/contract/src/guardian-recovery.compact#storeSharesCidHash] — On-chain shares CID hash storage
- [Source: shared/ipfs-service/src/IpfsService.ts] — IPFS upload/download interface
- [Source: _bmad-output/project-planning-artifacts/epics.md#Story-3.2] — Epic definition

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- TypeScript `Uint8Array` vs `BufferSource` strict typing: Web Crypto API methods need `as BufferSource` cast in TS5+ strict mode
- `secrets.js-34r7h` latest is 2.0.2 (not 2.1.0) — corrected in package.json
- CLI test failure during regression check: pre-existing Rule 13 violation (`protobufjs`/`long` not in `packages/blockchain/cli/package.json`). Fixed by adding explicit deps. Not caused by Story 3.2 changes.
- Shamir shares from `secrets.js-34r7h` can have odd-length hex strings. Binary encoding via `hexToUint8Array` drops last nibble. Fixed with 1-byte odd-length flag prefix in RSA payload.

### Completion Notes List

- All 8 tasks and 31 subtasks implemented and verified
- 28 new unit tests across 3 test files, all passing (60 total including 32 existing)
- Full roundtrip test validates Pattern 6 dual-layer encryption end-to-end: setup -> decrypt 2-of-3 shares -> Shamir combine -> AES-GCM decrypt -> original master password
- `RecoveryPersistProvider` interface abstracts platform-specific I/O (IPFS, contract calls, SQLite) for testability
- All crypto uses Web Crypto API (`crypto.subtle`) exclusively — no Node.js `crypto` module, no `Buffer`
- Bonus fix: Added `protobufjs@^7.5.4` and `long@^5.3.2` to `packages/blockchain/cli/package.json` (pre-existing Rule 13 violation exposed by fresh `pnpm install`)
- Code review findings addressed (7 items: H1-H3, M1-M2, L1-L2):
  - H1: RSA-OAEP payload binary-encoded with odd-length flag — supports passwords up to ~160 chars (was ~66)
  - H2: Added CIDv0 rejection test for assertCIDv1 path
  - H3: Added input validation on setupGuardianRecovery() system boundary
  - M1: Replaced manual hex-to-bytes with hexToUint8Array in roundtrip test
  - M2: Fixed project-context.md Rule 1 code example to match Rule 12 / ADR-006
  - L1: Made BufferSource casts consistent across all crypto.subtle calls
  - L2: Added edge case tests: empty string, unicode, long password (128 chars)

### Change Log

- 2026-02-22: **ADR-007 — Pattern 6 v2 (Inverted Shamir).** Architecture amended post-review: recovery key is now ephemeral (derived from Shamir shares), not stored in vault blob or private state. Eliminates circular dependency. Story 3.2 code needs refactoring to v2 in a follow-up (change Shamir input from encrypted password to random secret, add encryptedPassword to IPFS package, remove persistRecoveryKey from provider interface). Updated: architecture.md, project-context.md, epics.md, 2-6 spec.
- 2026-02-22: Story 3.2 marked done. Both code reviews passed — 7 findings addressed from first review, 5 findings from second review assessed as not actionable at story scope (architecture-level or already mitigated). Added Rule 16 to project-context.md.
- 2026-02-22: Story 3.2 implementation complete. Recovery crypto module, setup orchestration, and persistence flow with 28 tests. Fixed pre-existing CLI dep issue. Addressed all 7 code review findings.

### File List

- `shared/vault-sync/package.json` — MODIFIED: added `secrets.js-34r7h@^2.0.2` dependency
- `shared/vault-sync/src/secrets-types.d.ts` — NEW: type declarations for secrets.js-34r7h
- `shared/vault-sync/src/recovery-crypto.ts` — NEW: pure crypto functions (AES-GCM, Shamir, RSA-OAEP with binary encoding, key generation)
- `shared/vault-sync/src/recovery-setup.ts` — NEW: orchestration logic with input validation, GuardianSharePackage type, setupGuardianRecovery()
- `shared/vault-sync/src/recovery-persist.ts` — NEW: RecoveryPersistProvider interface, persistGuardianRecovery()
- `shared/vault-sync/src/recovery-crypto.test.ts` — NEW: 15 unit tests for crypto functions (incl. edge cases)
- `shared/vault-sync/src/recovery-setup.test.ts` — NEW: 7 unit tests for setup orchestration (incl. full roundtrip + validation)
- `shared/vault-sync/src/recovery-persist.test.ts` — NEW: 6 unit tests for persistence flow (incl. CIDv0 rejection)
- `shared/vault-sync/src/index.ts` — MODIFIED: added recovery module exports
- `packages/blockchain/cli/package.json` — MODIFIED: added explicit `protobufjs`/`long` deps (Rule 13 fix)
- `_bmad-output/project-context.md` — MODIFIED: fixed Rule 1 code example (Rule 12/ADR-006 alignment)
- `pnpm-lock.yaml` — MODIFIED: lockfile updated
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED: story status updated
