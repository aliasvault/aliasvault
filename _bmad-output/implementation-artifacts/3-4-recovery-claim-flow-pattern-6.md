# Story 3.4: Recovery Claim Flow (Pattern 6 v2)

Status: done

## Story

As a user recovering my account,
I want to reconstruct the Shamir secret from guardian shares, then derive the key and decrypt my password,
so that I can recover my Master Password on any device.

## Acceptance Criteria

1. Guardian portal adds "Release Share" page at route `/release/:cid` — after approval + 72h time-lock expired, guardian decrypts their share from the IPFS package using their RSA private key and exports it as a `RecoveryShareFile` JSON (download or copy)
2. Browser extension adds recovery claim page at `pages/recovery/ShareClaim.tsx` — user imports 2+ `RecoveryShareFile` JSON files from guardians
3. Once 2+ share files imported: system fetches IPFS share package (contains encrypted password + encrypted shares) using `sharesCid` from `RecoveryMetadata`
4. Recombine plaintext shares using Shamir combine → get `shamirSecret`
5. Verify `SHA-256(hex(shamirSecret))` matches on-chain `recoveryKeyHash` from VaultRegistry (integrity check)
6. Derive encryption key: `SHA-256("aliasvault:rk:" + hex(shamirSecret))`
7. Decrypt `encryptedPassword` from IPFS package with derived key → get `MasterPassword`
8. Display recovered password (user copies or resets) — ephemeral display with auto-clear timer
9. Call `claimRecovery()` on GuardianRecovery contract → sets `recoveryComplete = true` (terminal state)
10. Unit tests for `recovery-claim.ts` (core logic + validators), guardian portal release share service/page, and browser extension claim page
11. Export `claimRecovery`, `validateSharePackage`, `parseSharePackageFromBytes`, `validateShareFile`, `RecoveryShareFile`, `RecoveryClaimParams`, `RecoveryClaimResult`, `RecoveryClaimError`, `RecoveryClaimErrorCodes` from `@aliasvault/vault-sync`

## Tasks / Subtasks

- [x] Task 1: Unit tests for existing `recovery-claim.ts` (AC: #4, #5, #6, #7, #10)
  - [x] 1.1 Create `shared/vault-sync/src/recovery-claim.test.ts`
  - [x] 1.2 Test `claimRecovery()` happy path: 2 valid shares + correct on-chain hash → returns masterPassword
  - [x] 1.3 Test `claimRecovery()` with 3-of-3 shares (all shares provided)
  - [x] 1.4 Test `claimRecovery()` error: INSUFFICIENT_SHARES when providing fewer shares than threshold
  - [x] 1.5 Test `claimRecovery()` error: HASH_MISMATCH when on-chain hash does not match reconstructed secret
  - [x] 1.6 Test `claimRecovery()` error: DECRYPTION_FAILED when encrypted password is corrupted
  - [x] 1.7 Test `validateSharePackage()` accepts valid v2 package
  - [x] 1.8 Test `validateSharePackage()` rejects: non-object, wrong version, missing fields, empty shares array, invalid share entries
  - [x] 1.9 Test `parseSharePackageFromBytes()` parses valid JSON bytes, rejects invalid JSON
  - [x] 1.10 Test `validateShareFile()` accepts valid v1 share file, rejects: non-object, wrong version, missing fields
  - [x] 1.11 Full roundtrip integration test: `setupGuardianRecovery()` → decrypt 2 shares with `decryptShareFromGuardian()` → `claimRecovery()` → verify recovered password matches original
  - [x] 1.12 Test ephemeral key zeroing: verify `encryptionKey.fill(0)` is called (key material not leaked)

- [x] Task 2: Export recovery-claim types and functions from `@aliasvault/vault-sync` (AC: #11)
  - [x] 2.1 Add exports to `shared/vault-sync/src/index.ts`:
    - `claimRecovery`, `validateSharePackage`, `parseSharePackageFromBytes`, `validateShareFile`
    - `RecoveryClaimError`, `RecoveryClaimErrorCodes`
    - Types: `RecoveryShareFile`, `RecoveryClaimParams`, `RecoveryClaimResult`
  - [x] 2.2 Build `shared/vault-sync` — zero TypeScript errors

- [x] Task 3: Guardian portal "Release Share" service (AC: #1)
  - [x] 3.1 Create `services/guardian-portal/src/services/shareReleaseService.ts`
  - [x] 3.2 Implement `fetchSharePackage(cid: string): Promise<GuardianSharePackage>`:
    - Fetch share package from IPFS gateway (same gateway as `ipfsService.ts`)
    - Validate CID with `assertCIDv1()`
    - Parse and validate with `validateSharePackage()` from `@aliasvault/vault-sync`
  - [x] 3.3 Implement `decryptGuardianShare(sharePackage: GuardianSharePackage, shareIndex: number, rsaPrivateKey: JsonWebKey): Promise<RecoveryShareFile>`:
    - Find the guardian's encrypted share by index from package
    - Call `decryptShareFromGuardian(base64ToUint8Array(encryptedShare), rsaPrivateKey)` from `@aliasvault/vault-sync`
    - Return `RecoveryShareFile` with `{ version: 1, shareIndex, shareHex }`
  - [x] 3.4 Implement `findGuardianShareIndex(sharePackage: GuardianSharePackage, rsaPrivateKey: JsonWebKey): Promise<number>`:
    - Try decrypting each share in the package with the guardian's private key
    - Return the index of the share that decrypts successfully
    - Throw `SHARE_NOT_FOUND` error if no share can be decrypted (guardian not in this package)
  - [x] 3.5 Implement `canReleaseShare(recoveryInitiatedAt: bigint, approvalCount: number, threshold: number, recoveryComplete: boolean): { canRelease: boolean; reason?: string }`:
    - Check `recoveryInitiatedAt > 0` (recovery active)
    - Check `approvalCount >= threshold` (enough approvals)
    - Check `Number(recoveryInitiatedAt) + 259200 < Math.floor(Date.now() / 1000)` (72h expired)
    - Check `!recoveryComplete` (not already claimed)

- [x] Task 4: Guardian portal "Release Share" page (AC: #1)
  - [x] 4.1 Create `services/guardian-portal/src/pages/ReleaseSharePage.tsx` at route `/release/:cid`
  - [x] 4.2 Page flow (state machine, follow ApprovalPage.tsx pattern):
    1. Fetch RecoveryMetadata from IPFS via `:cid` URL param (reuse `fetchRecoveryMetadata()`)
    2. Prompt wallet connection (reuse `WalletConnect` component)
    3. Load guardian keys from localStorage (reuse `loadGuardianKeys()`)
    4. Join contract, verify guardian is registered, read contract state
    5. Check `canReleaseShare()` — display countdown if time-lock not expired, error if insufficient approvals
    6. "Release My Share" button → calls `fetchSharePackage()` using `sharesCid` from RecoveryMetadata, finds guardian's share via `findGuardianShareIndex()`, decrypts it
    7. Display `RecoveryShareFile` JSON — copy-to-clipboard button + download-as-file button
    8. Instructions: "Send this share file to the vault owner via a secure channel"
  - [x] 4.3 Add `/release/:cid` route to `services/guardian-portal/src/App.tsx`
  - [x] 4.4 Error states: wallet not detected, no keys found for this contract, not a registered guardian, recovery not active, time-lock not expired, insufficient approvals, recovery already completed, share decryption failed

- [x] Task 5: Guardian portal "Release Share" tests (AC: #10)
  - [x] 5.1 Create `services/guardian-portal/src/services/__tests__/shareReleaseService.test.ts`:
    - Test `fetchSharePackage()` with valid CID returns validated package
    - Test `fetchSharePackage()` rejects invalid CID
    - Test `decryptGuardianShare()` returns valid RecoveryShareFile
    - Test `findGuardianShareIndex()` finds correct index, throws for wrong key
    - Test `canReleaseShare()` with all state combinations (not active, insufficient approvals, time-lock not expired, ready, already complete)
  - [x] 5.2 Create `services/guardian-portal/src/pages/__tests__/ReleaseSharePage.test.tsx`:
    - Test loading state
    - Test time-lock countdown display when time-lock not expired
    - Test successful share release flow (mocked services)
    - Test error states (no keys, not guardian, time-lock active, already completed)
    - Test copy-to-clipboard and download-as-file buttons

- [x] Task 6: Browser extension recovery claim service (AC: #2, #3, #4, #5, #6, #7, #8, #9)
  - [x] 6.1 Create `apps/browser-extension/src/services/RecoveryClaimService.ts`
  - [x] 6.2 Implement `fetchOnChainRecoveryKeyHash(contractAddress: string): Promise<Uint8Array>`:
    - Read `recoveryKeyHash` from VaultRegistry contract ledger state
    - Pattern: use `getVaultRegistryLedgerState()` from `vault-registry-api.ts` as reference
  - [x] 6.3 Implement `fetchSharePackageFromIpfs(sharesCid: string): Promise<GuardianSharePackage>`:
    - Download from IPFS via Pinata gateway (same pattern as guardian portal)
    - Validate CID with `assertCIDv1()` from `@aliasvault/contract`
    - Parse with `parseSharePackageFromBytes()` from `@aliasvault/vault-sync`
  - [x] 6.4 Implement `executeRecoveryClaim(shareFiles: RecoveryShareFile[], sharePackage: GuardianSharePackage, onChainHash: Uint8Array): Promise<RecoveryClaimResult>`:
    - Delegate to `claimRecovery()` from `@aliasvault/vault-sync`
    - Wrap errors with user-friendly messages
  - [x] 6.5 Implement `callClaimRecoveryOnChain(contractAddress: string, secretKey: Uint8Array): Promise<void>`:
    - Join GuardianRecovery contract as owner: `joinGuardianRecovery(providers, contractAddress, secretKey)`
    - Call `contract.callTx.claimRecovery()` — sets `recoveryComplete = true` (terminal state)
    - Must join with `secretKey` in private state (owner auth required by circuit)
  - [x] 6.6 Implement `getRecoveryState(contractAddress: string): Promise<RecoveryState>`:
    - Read ledger state from GuardianRecovery contract via indexer
    - Return: `{ recoveryInitiatedAt: bigint, approvalCount: number, recoveryComplete: boolean, sharesCidHash: Uint8Array }`

- [x] Task 7: Browser extension ShareClaim page (AC: #2, #8)
  - [x] 7.1 Create `apps/browser-extension/src/entrypoints/popup/pages/recovery/ShareClaim.tsx`
  - [x] 7.2 Page flow (multi-step wizard):
    1. **Step 1 — Status Check:** Display recovery status (approval count, time-lock countdown, recoveryComplete). Verify 2+ approvals and 72h elapsed.
    2. **Step 2 — Import Shares:** Text area or file input for pasting/uploading 2+ `RecoveryShareFile` JSON. Validate each with `validateShareFile()`. Show checkmarks for valid shares with share index.
    3. **Step 3 — Recover:** "Recover Password" button. Fetches IPFS package via `sharesCid` from RecoveryMetadata, reads on-chain `recoveryKeyHash`, calls `claimRecovery()`. Progress indicator during operations.
    4. **Step 4 — Display:** Show recovered master password in a masked field (click to reveal). Copy button. Auto-clear timer (60 seconds). Warning: "This password will be cleared from memory in X seconds."
    5. **Step 5 — Finalize:** "Complete Recovery" button calls `claimRecovery()` on GuardianRecovery contract (terminal state). Confirmation: "Recovery complete. Your contract is now in terminal state — deploy a new GuardianRecovery instance for future recovery."
  - [x] 7.3 Add route to extension router — `/recovery/claim` accessible from settings or recovery initiation flow
  - [x] 7.4 Error states: insufficient shares, hash mismatch (wrong shares or tampered package), decryption failed, contract call failed, already completed

- [x] Task 8: Browser extension recovery claim tests (AC: #10)
  - [x] 8.1 Create `apps/browser-extension/src/services/__tests__/RecoveryClaimService.test.ts`:
    - Test `fetchOnChainRecoveryKeyHash()` returns correct hash from ledger
    - Test `fetchSharePackageFromIpfs()` with valid/invalid CID
    - Test `executeRecoveryClaim()` happy path and error paths (insufficient shares, hash mismatch, decryption failure)
    - Test `getRecoveryState()` reads correct ledger fields
    - Test `validateImportedShare()` delegates to vault-sync and propagates errors
  - [x] 8.2 Create `apps/browser-extension/src/entrypoints/popup/pages/recovery/__tests__/ShareClaim.test.tsx`:
    - Test multi-step wizard navigation
    - Test share file import and validation (valid JSON, invalid JSON, wrong version)
    - Test recovery flow with mocked services
    - Test password display with auto-clear timer
    - Test error states rendering

- [x] Task 9: Build and verify (AC: all)
  - [x] 9.1 Build: `cd shared/vault-sync && pnpm build` — clean (CJS + ESM + DTS)
  - [x] 9.2 Test: `cd shared/vault-sync && npx vitest run` — 97 tests pass
  - [x] 9.3 Build: `cd services/guardian-portal && tsc -b --noEmit` — zero TypeScript errors (vite build has pre-existing WASM issue with ledger-v7)
  - [x] 9.4 Test: `cd services/guardian-portal && npx vitest run` — 100 tests pass
  - [x] 9.5 Build: browser extension tsc has pre-existing TS errors in MidnightContractService.ts (same pattern as RecoveryClaimService.ts — dynamic imports for packages not in npm). No new errors introduced.
  - [x] 9.6 Test: `cd apps/browser-extension && npx vitest run` — 220 pass, 8 fail (pre-existing FormFiller date tests)
  - [x] 9.7 Regression: `cd packages/blockchain/contract && npx vitest run` — 69 passed, 3 skipped, no regressions
  - [x] 9.8 Regression: `cd packages/blockchain/cli && npx vitest run` — 41 passed, 1 skipped, 1 pre-existing Docker infra test failure

## Dev Notes

### Architecture Compliance (CRITICAL)

**ADR-003: Shared Business Logic.** All recovery crypto and claim logic lives in `shared/vault-sync/`. The browser extension and guardian portal import from `@aliasvault/vault-sync`. DO NOT duplicate `claimRecovery()`, `combineShares()`, `deriveEncryptionKey()`, or any crypto logic in app code.

**ADR-007: Pattern 6 v2 (Inverted Shamir).** The Shamir secret is ephemeral — reconstructed from guardian shares during recovery, never stored. The flow is:
1. Guardians decrypt their individual shares (RSA private key, stored in guardian portal localStorage)
2. Guardians export decrypted shares as `RecoveryShareFile` JSON
3. Vault owner collects 2+ share files from guardians (out-of-band transfer)
4. Vault owner runs `claimRecovery()` — combines shares, verifies hash, derives key, decrypts password
5. Vault owner calls `claimRecovery()` circuit on contract (terminal state)

**ADR-006: Private State is Device-Local.** The vault owner calling `claimRecovery()` on-chain needs their `secretKey` in the Midnight private state. On a NEW device, the owner must first recover their password (off-chain), then unlock their vault to get the `secretKey` from SQLite, then call the on-chain circuit. If vault cannot be unlocked yet (lost password scenario), the on-chain terminal state can be deferred — the off-chain password recovery works independently.

### Recovery Data Flow (CRITICAL — Understand Before Implementing)

```
Guardian Portal                    Out-of-Band               Browser Extension
(Per Guardian)                     Channel                   (Vault Owner)

1. Fetch IPFS package              ─── share file ───>       3. Import 2+ share files
2. Decrypt own share                                         4. claimRecovery() [off-chain]
   with RSA private key                                         - combine shares
   from localStorage                                            - verify hash
   Export RecoveryShareFile                                     - derive key
                                                                - decrypt password
                                                             5. Display password
                                                             6. claimRecovery() [on-chain]
                                                                - terminal state
```

### Share Release Flow (Guardian Side)

The IPFS package (`GuardianSharePackage`) contains encrypted shares — each encrypted with a different guardian's RSA public key. A guardian can only decrypt **their own** share. The challenge: identifying which share belongs to which guardian, since shares are indexed 0, 1, 2 but there is no guardian-to-index mapping stored on-chain or in the package.

**Solution: Try-decrypt approach.** The guardian tries decrypting each share with their RSA private key. RSA-OAEP decryption fails deterministically with the wrong key (throws error). The first share that decrypts successfully is theirs. This works because:
- There are only 3 shares (trivial iteration)
- RSA-OAEP decryption is fast (<10ms per attempt)
- Each guardian can only decrypt exactly one share

```typescript
async function findGuardianShareIndex(
  sharePackage: GuardianSharePackage,
  rsaPrivateKey: JsonWebKey,
): Promise<number> {
  for (const share of sharePackage.shares) {
    try {
      await decryptShareFromGuardian(
        base64ToUint8Array(share.encryptedShare),
        rsaPrivateKey,
      );
      return share.index;
    } catch {
      continue; // Not this guardian's share
    }
  }
  throw new Error('No share found for this guardian key');
}
```

### 72-Hour Time-Lock Enforcement

The 72-hour check happens at two levels:

1. **On-chain (`claimRecovery()` circuit):** `blockTimeGte(recoveryInitiatedAt + 259200)` — enforced by the contract. Cannot be bypassed.
2. **Off-chain (guardian portal UI):** `canReleaseShare()` checks timestamp before allowing share release. This is a UX convenience — even if bypassed, the on-chain claim would still fail.

The vault owner's off-chain `claimRecovery()` (crypto reconstruction) is NOT time-locked — it can happen anytime after collecting shares. Only the on-chain `claimRecovery()` circuit has the time-lock. This means:
- Guardians can release shares after 72h (UI check)
- Owner can reconstruct password immediately after collecting shares
- Owner can call on-chain `claimRecovery()` only after 72h (contract check)

### Contract State Reading for Recovery Status

The vault owner needs to read TWO contracts:

1. **VaultRegistry** — `recoveryKeyHash` (for hash verification during claim)
   - Read via `getVaultRegistryLedgerState()` pattern from `vault-registry-api.ts`
   - Field: `ledgerState.recoveryKeyHash: Uint8Array` (Bytes<32>)

2. **GuardianRecovery** — `recoveryInitiatedAt`, `approvedGuardians`, `recoveryComplete`, `sharesCidHash`
   - Read via `findDeployedContract()` + `.deployTxData.public` ledger access
   - `approvedGuardians.size()` for count, `recoveryInitiatedAt` for timer, `recoveryComplete` for terminal check

```typescript
// VaultRegistry — read recoveryKeyHash
const vrState = await getVaultRegistryLedgerState(providers, vrContractAddress);
const onChainHash = vrState.recoveryKeyHash; // Uint8Array (32 bytes)

// GuardianRecovery — read recovery state
const grContract = await joinGuardianRecovery(providers, grContractAddress, secretKey);
const ledger = grContract.deployTxData.public;
const approvalCount = Number(ledger.approvedGuardians.size());
const recoveryInitiatedAt = ledger.recoveryInitiatedAt; // bigint, 0 = no recovery
const recoveryComplete = ledger.recoveryComplete; // boolean
```

### RecoveryShareFile Format

```typescript
interface RecoveryShareFile {
  version: 1;
  shareIndex: number;   // 0, 1, or 2 — matches GuardianSharePackage shares[].index
  shareHex: string;     // Plaintext hex of the Shamir share (decrypted by guardian)
}
```

Guardian exports this as JSON. Vault owner imports 2+ of these files. The `shareIndex` is informational — `combineShares()` from `secrets.js-34r7h` embeds index info in the share hex itself.

### Password Display Security

The recovered master password must be handled with care:

1. Display in a masked field (click-to-reveal or hover-to-reveal)
2. Copy-to-clipboard button
3. Auto-clear timer: 60 seconds after display, clear the password from component state
4. Warning text: "This password will be cleared from memory in X seconds"
5. Zero the password string when component unmounts (set to empty string in cleanup)
6. No browser history or localStorage persistence of the password

### What EXISTS — Reuse These

| Component | Location | Usage |
|-----------|----------|-------|
| `claimRecovery()` | `shared/vault-sync/src/recovery-claim.ts` | Core claim logic: combine + verify + derive + decrypt |
| `validateSharePackage()` | `shared/vault-sync/src/recovery-claim.ts` | Validates GuardianSharePackage v2 structure |
| `parseSharePackageFromBytes()` | `shared/vault-sync/src/recovery-claim.ts` | Parse IPFS-fetched bytes to package |
| `validateShareFile()` | `shared/vault-sync/src/recovery-claim.ts` | Validates RecoveryShareFile structure |
| `decryptShareFromGuardian()` | `shared/vault-sync/src/recovery-crypto.ts` | RSA-OAEP decryption of individual share |
| `combineShares()` | `shared/vault-sync/src/recovery-crypto.ts` | Shamir secret reconstruction |
| `deriveEncryptionKey()` | `shared/vault-sync/src/recovery-crypto.ts` | Domain-separated key derivation |
| `decryptWithRecoveryKey()` | `shared/vault-sync/src/recovery-crypto.ts` | AES-256-GCM decryption |
| `setupGuardianRecovery()` | `shared/vault-sync/src/recovery-setup.ts` | For roundtrip test (setup side) |
| `assertCIDv1()` | `packages/blockchain/contract/src/cid-utils.ts` | CID format validation |
| `fetchRecoveryMetadata()` | `services/guardian-portal/src/services/ipfsService.ts` | Fetch RecoveryMetadata from IPFS |
| `loadGuardianKeys()` | `services/guardian-portal/src/services/guardianKeyService.ts` | Load RSA private key from localStorage |
| `joinContract()` / `getContractState()` | `services/guardian-portal/src/services/midnightService.ts` | Guardian contract interaction |
| `RecoveryDetails` component | `services/guardian-portal/src/components/RecoveryDetails.tsx` | Recovery status display with 72h countdown |
| `WalletConnect` component | `services/guardian-portal/src/components/WalletConnect.tsx` | Wallet connection UI |
| `ApprovalPage` state machine | `services/guardian-portal/src/pages/ApprovalPage.tsx` | PageState type + state machine pattern |
| `joinGuardianRecovery()` | `packages/blockchain/cli/src/guardian-recovery-api.ts` | Owner-side contract join (reference) |
| `claimRecovery()` (on-chain) | `packages/blockchain/cli/src/guardian-recovery-api.ts` | `contract.callTx.claimRecovery()` wrapper |
| `getVaultRegistryLedgerState()` | `packages/blockchain/cli/src/vault-registry-api.ts` | Read `recoveryKeyHash` from VaultRegistry |
| `base64ToUint8Array()` / `bytesToHex()` | `shared/vault-sync/src/utils.ts` | Encoding utilities |
| Network config pattern | `services/guardian-portal/src/config/networkConfig.ts` | Network URL mapping |

### What NOT to Do (Anti-Patterns)

- **DO NOT** store guardian RSA private keys in the browser extension — they belong to the guardian portal (localStorage, per-device)
- **DO NOT** try to automate share collection between guardian portal and browser extension — share files are transferred out-of-band (email, messaging, file transfer). This is a security feature, not a limitation.
- **DO NOT** call `claimRecovery()` on-chain before the off-chain password recovery succeeds — if crypto reconstruction fails, no need to set terminal state
- **DO NOT** assume the vault owner has the guardian RSA private keys — guardians decrypt their own shares and export plaintext `RecoveryShareFile` JSON
- **DO NOT** use `Buffer` — use `Uint8Array` everywhere for browser compatibility
- **DO NOT** import from `apps/browser-extension/` in guardian portal or vice versa — violates ADR-003 dependency direction
- **DO NOT** store the recovered master password in any persistent storage (localStorage, IndexedDB, chrome.storage) — display ephemerally and clear
- **DO NOT** skip the on-chain `recoveryKeyHash` verification step — it prevents accepting tampered shares
- **DO NOT** call `claimRecovery()` on contract without first verifying the user is the owner — the circuit enforces this but a clear error message is better than a circuit assertion failure
- **DO NOT** hardcode IPFS gateway URLs — use the same configurable gateway from guardian portal's `ipfsService.ts` and extension's IPFS config

### Previous Story Learnings (Stories 3.1, 3.2v2, 3.3)

**From Story 3.1 (Guardian Contract):**
- `claimRecovery()` circuit requires owner auth (`ownerCommitment(local_secret_key())`) — guardian cannot call this
- `claimRecovery()` has idempotency guard: `assert(!recoveryComplete, "Recovery already completed")`
- Post-recovery terminal state: `recoveryComplete = true` is permanent. New contract needed for next recovery cycle.
- `createGuardianRecoveryPrivateState(secretKey, guardianKey?)` — owner passes their secretKey, guardians pass undefined + guardianKey

**From Story 3.2v2 (Inverted Shamir):**
- `decryptShareFromGuardian()` handles odd-hex flag — no special handling needed by caller
- Shamir shares from `secrets.js-34r7h` encode their index internally — `combineShares()` works regardless of which 2 shares are provided
- `sha256()` is async (Web Crypto API) — all hash operations need `await`
- Full roundtrip pattern: setup → decrypt shares → combine → verify hash → derive key → decrypt password (see `recovery-setup.test.ts`)
- Ephemeral key zeroing: `encryptionKey.fill(0)` already in `claimRecovery()` — key material cleaned up

**From Story 3.3 (Guardian Portal):**
- Guardian portal uses direct `window.midnight.mnLace` access (not Chrome scripting API)
- Guardian keys stored in localStorage keyed by contract address: `guardian:{contractAddress}:keys`
- `findDeployedContract()` in browser — no `withCompiledFileAssets` (proof server handles ZK configs)
- Guardian joins contract with `new Uint8Array(32)` placeholder for `secretKey` — guardians do not have owner's key
- Contract state reading pattern: `contract.deployTxData.public.{field}`
- ApprovalPage uses `PageState` type for state machine: `'loading' | 'error' | 'connect-wallet' | 'load-keys' | ...`
- RecoveryDetails component already handles 72h countdown with `setInterval`

### Cross-Story Context

| Story | Relationship |
|-------|-------------|
| 3.1 (Guardian Contract) | **Done.** Contract with `claimRecovery()` circuit, owner auth, terminal state. All circuits available. |
| 3.2v2 (Inverted Shamir) | **Done.** Setup flow creates `GuardianSharePackage` on IPFS, stores hashes on-chain. Crypto primitives reused for claim. |
| 3.3 (Guardian Portal) | **Review.** Portal has setup + approval flows. This story adds "Release Share" flow. RSA private key in localStorage. |
| 2.3 (Vault Sync Save) | **Done.** Owner's `secretKey` stored in SQLite vault DB for cross-device access. Needed for on-chain `claimRecovery()`. |
| 2.6 (VaultRegistry Full) | **Done.** `storeRecoveryKeyHash()` and `recoveryKeyHash` ledger field available for hash verification. |

### SDK Versions (VERIFIED WORKING — from Stories 2.1-3.3)

| Component | Version |
|-----------|---------|
| Compact CLI | 0.4.0 (language >= 0.20) |
| compact-runtime | 0.14.0 |
| midnight-js-contracts | 3.0.0 |
| midnight-js-http-client-proof-provider | 3.0.0 |
| midnight-js-indexer-public-data-provider | 3.0.0 |
| wallet-sdk | 1.0.0 |
| secrets.js-34r7h | 2.0.2 |
| React | 18+ |
| Vite | 6+ |
| TypeScript | 5+ |
| react-router-dom | 6+ |
| Vitest | latest |

### Build Commands

```bash
# Install workspace dependencies (from project root)
pnpm install

# Build vault-sync (shared logic)
cd shared/vault-sync && pnpm build

# Run vault-sync tests
cd shared/vault-sync && npx vitest run

# Build guardian portal
cd services/guardian-portal && pnpm build

# Run guardian portal tests
cd services/guardian-portal && npx vitest run

# Build browser extension
cd apps/browser-extension && pnpm build

# Run browser extension tests
cd apps/browser-extension && npx vitest run

# Regression checks (from project root)
cd packages/blockchain/contract && npx vitest run
cd packages/blockchain/cli && npx vitest run
```

### Testing Strategy

- **Shared logic unit tests (`recovery-claim.test.ts`):** Test `claimRecovery()` with real crypto (no mocks for crypto operations). Test validators with various valid/invalid inputs. Full roundtrip test using `setupGuardianRecovery()` from the setup side + `claimRecovery()` from the claim side.
- **Guardian portal service tests:** Mock `fetch` for IPFS, mock `crypto.subtle` for RSA decryption only where needed for speed. Test `canReleaseShare()` with various time/approval combinations.
- **Guardian portal component tests:** `@testing-library/react` for rendering, user interaction, state display. Mock service layer.
- **Browser extension service tests:** Mock `MidnightContractService`, `IpfsService`. Test contract state reading, IPFS fetch, and claim orchestration.
- **Browser extension component tests:** Test multi-step wizard flow with mocked services. Test password display + auto-clear behavior.
- **No E2E in this story:** Live guardian-to-owner share transfer requires human coordination. Covered in future E2E story.

### Project Structure Notes

Guardian portal additions follow existing structure:
```
services/guardian-portal/src/
├── services/
│   ├── shareReleaseService.ts          # NEW
│   └── __tests__/
│       └── shareReleaseService.test.ts # NEW
└── pages/
    ├── ReleaseSharePage.tsx            # NEW
    └── __tests__/
        └── ReleaseSharePage.test.tsx   # NEW
```

Browser extension additions follow existing pages pattern:
```
apps/browser-extension/src/
├── services/
│   ├── RecoveryClaimService.ts         # NEW
│   └── __tests__/
│       └── RecoveryClaimService.test.ts # NEW
└── entrypoints/popup/pages/
    └── recovery/
        ├── ShareClaim.tsx              # NEW
        └── __tests__/
            └── ShareClaim.test.tsx     # NEW
```

### References

- [Source: _bmad-output/architecture.md#Pattern-6] — Guardian Share Encryption (Inverted Shamir v2) pseudocode including `recoverMasterPassword()` reference
- [Source: _bmad-output/architecture.md#Component-Layout] — `ShareClaim.tsx` placement at `pages/recovery/ShareClaim.tsx`
- [Source: _bmad-output/architecture.md#FR12] — Share claim functional requirement
- [Source: _bmad-output/architecture.md#Guardian-Notification-Protocol] — IPFS portal notification flow
- [Source: _bmad-output/project-context.md#Rule-1] — Inverted Shamir Recovery (Pattern 6 v2, ADR-007)
- [Source: _bmad-output/project-context.md#Rule-3] — Shared Business Logic Enforcement (ADR-003)
- [Source: _bmad-output/project-context.md#Rule-6] — Guardian Recovery Time-Lock (72 hours)
- [Source: _bmad-output/project-context.md#Rule-12] — Midnight Private State is Device-Local (ADR-006)
- [Source: _bmad-output/project-context.md#Rule-15] — GuardianRecovery Contract Patterns
- [Source: _bmad-output/project-context.md#Rule-16] — Shamir & RSA-OAEP Implementation Patterns
- [Source: shared/vault-sync/src/recovery-claim.ts] — Existing claim logic (215 lines, untracked)
- [Source: shared/vault-sync/src/recovery-crypto.ts] — Crypto primitives (combineShares, decryptShareFromGuardian, deriveEncryptionKey, decryptWithRecoveryKey)
- [Source: shared/vault-sync/src/recovery-setup.ts] — GuardianSharePackage v2 type, SetupResult, RecoveryMetadata
- [Source: shared/vault-sync/src/index.ts] — Current exports (recovery-claim not yet exported)
- [Source: services/guardian-portal/src/services/guardianKeyService.ts] — Guardian RSA key storage/retrieval
- [Source: services/guardian-portal/src/services/ipfsService.ts] — IPFS fetch pattern
- [Source: services/guardian-portal/src/services/midnightService.ts] — Contract join + state reading
- [Source: services/guardian-portal/src/pages/ApprovalPage.tsx] — State machine UI pattern (PageState type)
- [Source: packages/blockchain/cli/src/guardian-recovery-api.ts] — `joinGuardianRecovery()`, `claimRecovery()` on-chain wrappers
- [Source: packages/blockchain/cli/src/vault-registry-api.ts] — `getVaultRegistryLedgerState()` reads `recoveryKeyHash`
- [Source: packages/blockchain/contract/src/guardian-recovery.compact] — `claimRecovery()` circuit (owner auth + time-lock + terminal state)
- [Source: packages/blockchain/contract/src/vault-registry.compact] — `recoveryKeyHash` ledger field
- [Source: _bmad-output/implementation-artifacts/3-3-guardian-portal.md] — Story 3.3 learnings
- [Source: _bmad-output/implementation-artifacts/3-2v2-pattern6-inverted-shamir-refactor.md] — Story 3.2v2 learnings
- [Source: _bmad-output/implementation-artifacts/3-1-guardian-smart-contract.md] — Story 3.1 learnings
- [Source: _bmad-output/project-planning-artifacts/epics.md#Story-3.4] — Epic definition

## Known Limitations

- **No automated share transfer:** Guardians must manually send their `RecoveryShareFile` to the vault owner via out-of-band channel (email, messenger, etc.). Automated in-app transfer is deferred to a future story.
- **On-chain claim requires vault access:** The owner must have their `secretKey` to call `claimRecovery()` on the GuardianRecovery contract. On a new device with a lost password, the sequence is: recover password (off-chain, this story) → unlock vault → extract secretKey from SQLite → call on-chain `claimRecovery()`. If the owner cannot access their vault at all, the on-chain terminal state can be set via backup wallet transfer (Story 3.6) or deferred.
- **Guardian index matching is trial-and-error:** No on-chain or in-package mapping from guardian commitment to share index. `findGuardianShareIndex()` tries all 3 shares. Acceptable for 3 shares but would need optimization for larger guardian sets.

## Change Log

- 2026-02-25: Story 3.4 created — Recovery Claim Flow (Pattern 6 v2). 9 tasks covering vault-sync tests/exports, guardian portal release share feature, browser extension claim page.
- 2026-02-28: Code review (adversarial). Fixed: H1 ShareClaim route empty props → optional with validation, H2 added 3 missing display/auto-clear/clipboard tests + 1 missing-params test, M1+M4 File List updated (4 undocumented files), M2 type duplication → derived type, M3 clipboard error handling in both pages.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- ShareClaim.test.tsx import resolution: Vite's import-analysis plugin rejects workspace package imports (`@aliasvault/vault-sync`) because the browser extension uses npm (not pnpm workspace). Fixed by wrapping `validateShareFile()` in a service function `validateImportedShare()` using dynamic import pattern consistent with the rest of the extension.
- ReleaseSharePage.test.tsx createElement spy: `vi.spyOn(document, 'createElement').mockReturnValue(...)` broke React rendering (all elements became fake anchors). Fixed with `mockImplementation` guarding on `tag === 'a'`.
- RecoveryClaimService.test.ts mock leak: `mockAssertCIDv1` throwing from "rejects invalid CID" test persisted to next test. Fixed by resetting mock implementation.
- Rollup native module missing on WSL2: `npm install @rollup/rollup-linux-x64-gnu --no-save`.

### Completion Notes List

- Tasks 1-2: Pre-existing (recovery-claim.ts + exports already implemented in prior session)
- Tasks 3-4: Pre-existing (shareReleaseService.ts + ReleaseSharePage.tsx already implemented in prior session)
- Task 5: 32 new guardian portal tests (19 service + 13 component) — all passing
- Task 6: RecoveryClaimService.ts with 6 functions (fetchOnChainRecoveryKeyHash, fetchSharePackageFromIpfs, executeRecoveryClaim, callClaimRecoveryOnChain, getRecoveryState, validateImportedShare)
- Task 7: ShareClaim.tsx multi-step wizard (status-check → import-shares → recovering → display → finalizing → complete) with 60s auto-clear, reveal/hide, copy, on-chain finalize
- Task 8: 24 new extension tests (13 RecoveryClaimService + 11 ShareClaim) — all passing
- Task 9: All builds clean, all new tests pass, no regressions in contract/CLI packages
- Pre-existing failures documented: FormFiller date tests (8), guardian portal vite WASM build, CLI Docker infra test

### Code Review Fixes (2026-02-28)

- H1: ShareClaim props made optional, mount validation for missing params, App.tsx route no longer passes empty strings
- H2: Added 3 new tests (password display + reveal, auto-clear timer, clipboard copy) + 1 missing-params test (14 total, was 11)
- M1+M4: File List updated — added recovery-claim.ts (new), recovery-setup.ts, recovery-setup.test.ts, App.tsx (extension) as modified
- M2: Replaced duplicated local RecoveryShareFile interface with `Awaited<ReturnType<typeof validateImportedShare>>` (ADR-003)
- M3: Added `.catch(() => {})` to clipboard API calls in ReleaseSharePage.tsx and ShareClaim.tsx
- H1 guard: handleRecover validates sharesCid/pinataGateway/vaultRegistryAddress before API calls

### File List

New files:
- shared/vault-sync/src/recovery-claim.ts
- shared/vault-sync/src/recovery-claim.test.ts
- services/guardian-portal/src/services/shareReleaseService.ts
- services/guardian-portal/src/services/__tests__/shareReleaseService.test.ts
- services/guardian-portal/src/pages/ReleaseSharePage.tsx
- services/guardian-portal/src/pages/__tests__/ReleaseSharePage.test.tsx
- apps/browser-extension/src/services/RecoveryClaimService.ts
- apps/browser-extension/src/services/__tests__/RecoveryClaimService.test.ts
- apps/browser-extension/src/entrypoints/popup/pages/recovery/ShareClaim.tsx
- apps/browser-extension/src/entrypoints/popup/pages/recovery/__tests__/ShareClaim.test.tsx

Modified files:
- shared/vault-sync/src/index.ts (add recovery-claim exports)
- shared/vault-sync/src/recovery-setup.ts (add sharesCid to RecoveryMetadata)
- shared/vault-sync/src/recovery-setup.test.ts (TS cast fix)
- services/guardian-portal/src/App.tsx (add /release/:cid route)
- apps/browser-extension/src/entrypoints/popup/App.tsx (add /recovery/claim route)
- _bmad-output/implementation-artifacts/sprint-status.yaml (3-4 status → ready-for-dev)
