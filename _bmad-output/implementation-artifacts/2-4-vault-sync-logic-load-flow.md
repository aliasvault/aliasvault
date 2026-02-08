# Story 2.4: Vault Sync Logic (Load Flow)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to fetch my latest vault when I open the app,
so that I see my up-to-date credentials across devices.

## Acceptance Criteria

1. Read `vaultCidHash` from VaultRegistry public ledger (on-chain)
2. Download encrypted blob from IPFS using CID
3. Decrypt blob with local encryption key via `EncryptionUtility.symmetricDecrypt()`
4. Import into SQLite via `SqliteClient.initializeFromBase64()` (existing)
5. Handle "No vault found" case (new user — no registration on-chain)
6. Handle "New device" case (no local CID — discover CID via Pinata pin listing + hash matching)

## Tasks / Subtasks

- [x] Task 1: Extend shared VaultSyncService with load pipeline (AC: #1, #2)
  - [x] 1.1: Add `VaultLoadProvider` interface to `shared/vault-sync/src/types.ts` — `readContractCidHash()`, `getLocalCid()`, `downloadFromIpfs()`, `discoverCidByHash()`, `persistCid()`
  - [x] 1.2: Add `loadVault()` method to `VaultSyncService` — orchestrates: check on-chain hash → compare local → download → return bytes
  - [x] 1.3: Add `VaultLoadResult` type — `{ encryptedBytes: Uint8Array, cid: string, cidHash: string, source: 'local-cache' | 'ipfs-download' }`
  - [x] 1.4: Add load-specific error codes to `VaultSyncErrorCodes` — `VAULT_NOT_FOUND`, `CID_DISCOVERY_FAILED`, `IPFS_DOWNLOAD_FAILED`, `LEDGER_READ_FAILED`
  - [x] 1.5: Rebuild dist copy to `apps/browser-extension/src/utils/dist/shared/vault-sync/`
- [x] Task 2: Add MidnightContractService.readVaultCidHash() (AC: #1)
  - [x] 2.1: Add `readVaultCidHash(): Promise<Uint8Array | null>` — reads `vaultCidHash` from public ledger via indexer
  - [x] 2.2: Handle unregistered contract (return null if no owner set or cidHash is zero bytes)
  - [x] 2.3: Use `cachedContractService` from Story 2.3 — join once, read many
- [x] Task 3: Add PinataBrowserProvider.download() retry + CID discovery (AC: #2, #6)
  - [x] 3.1: Add retry logic to existing `download()` method (same `withRetry` pattern as upload)
  - [x] 3.2: Add `discoverCidByHash(cidHash: Uint8Array): Promise<string | null>` — queries Pinata pin list, SHA-256 hashes each CID, returns matching CID
  - [x] 3.3: Use Pinata Files API `GET /v3/files` to list pins (paginated)
  - [x] 3.4: CIDv1 validation on discovered CID before returning
- [x] Task 4: Create BrowserVaultLoadProvider (AC: #1, #2, #6)
  - [x] 4.1: Create `apps/browser-extension/src/services/BrowserVaultLoadProvider.ts` implementing `VaultLoadProvider`
  - [x] 4.2: Wire MidnightContractService, PinataBrowserProvider, VaultCidStore
  - [x] 4.3: `readContractCidHash()` → delegates to MidnightContractService
  - [x] 4.4: `getLocalCid()` → reads from VaultCidStore
  - [x] 4.5: `downloadFromIpfs(cid)` → delegates to PinataBrowserProvider.download()
  - [x] 4.6: `discoverCidByHash(cidHash)` → delegates to PinataBrowserProvider.discoverCidByHash()
  - [x] 4.7: `persistCid(cid, cidHash)` → delegates to VaultCidStore.set()
- [x] Task 5: Replace useVaultSync.ts with blockchain load flow (AC: #1-#6)
  - [x] 5.1: Replace `webApi.getStatus()` check with on-chain `readVaultCidHash()` via background message
  - [x] 5.2: Compare on-chain cidHash with local cidHash (from VaultCidStore)
  - [x] 5.3: If different → download new vault blob from IPFS, decrypt, load into SQLite
  - [x] 5.4: If same → vault is up to date, skip download
  - [x] 5.5: Handle no vault found (new user) — return gracefully, allow initial registration flow
  - [x] 5.6: Handle new device (no local CID) — trigger CID discovery via Pinata pin listing
  - [x] 5.7: Extract secretKey from SQLite Settings table on first load → cache in VaultCidStore (ADR-006)
  - [x] 5.8: Add new background message handler `LOAD_VAULT_FROM_BLOCKCHAIN` in VaultMessageHandler.ts
  - [x] 5.9: Keep `handleSyncVault()` as `@deprecated` fallback (same pattern as `uploadNewVaultToServer`)
- [x] Task 6: Update DbContext for blockchain vault loading (AC: #3, #4)
  - [x] 6.1: Add `initializeDatabaseFromBlob(encryptedBlobBase64: string, derivedKey: string)` method — simplified version without VaultResponse wrapper
  - [x] 6.2: Decrypts blob, initializes SQLite, sets state — same as `initializeDatabase()` but without email domain lists and revision number
  - [x] 6.3: Add `extractAndCacheSecretKey(sqliteClient)` method — reads secretKey from SQLite Settings, caches in VaultCidStore (ADR-006)
- [x] Task 7: Update i18n keys for load flow status (AC: #1-#6)
  - [x] 7.1: Add keys: `checkingBlockchain`, `noVaultFound`, `vaultUpToDate`, `decryptingVault`
- [x] Task 8: Unit tests (AC: #1-#6)
  - [x] 8.1: Test: loadVault returns null when cidHash matches local
  - [x] 8.2: Test: loadVault downloads from IPFS when cidHash differs from local
  - [x] 8.3: Test: loadVault triggers CID discovery when no local CID
  - [x] 8.4: Test: loadVault throws VAULT_NOT_FOUND when no registration on-chain
  - [x] 8.5: Test: CID discovery finds correct CID by hash matching
  - [x] 8.6: Test: CID discovery returns null when no matching pin
  - [x] 8.7: Test: download retry on transient failure (IPFS_DOWNLOAD_FAILED)
  - [x] 8.8: Test: LEDGER_READ_FAILED on indexer error + CID_DISCOVERY_FAILED on Pinata error + pipeline order
- [x] Task 9: Build verification
  - [x] 9.1: `pnpm build` in `shared/vault-sync/` succeeds (tsup CJS+ESM+DTS)
  - [x] 9.2: Dist copy to `apps/browser-extension/src/utils/dist/shared/vault-sync/` updated
  - [x] 9.3: All 32/32 tests pass (22 existing save + 10 new load)

## Dev Notes

### CRITICAL: This Replaces the Centralized Load Flow

The current load flow checks a .NET API server for vault updates. This story replaces it with a decentralized flow using IPFS + Midnight blockchain.

**Current flow (to be replaced):**
```
useVaultSync.ts (popup)
  → webApi.getStatus()  ← .NET API: returns vaultRevision number
  → compare revision with local vaultRevisionNumber
  → if newer: webApi.get<VaultResponse>('Vault')  ← .NET API: downloads vault
  → EncryptionUtility.symmetricDecrypt(blob, encryptionKey)
  → SqliteClient.initializeFromBase64(decryptedBlob)
```

**New flow (this story):**
```
useVaultSync.ts (popup)
  → sendMessage('LOAD_VAULT_FROM_BLOCKCHAIN', {}, 'background')
    → VaultMessageHandler.ts: handleLoadVaultFromBlockchain()
      → MidnightContractService.readVaultCidHash()  ← ON-CHAIN (public ledger via indexer)
      → compare cidHash with VaultCidStore.get().cidHash
      → if different:
        → VaultCidStore.get().cid  (same device: have CID)
        → OR PinataBrowserProvider.discoverCidByHash()  (new device: scan pins)
        → PinataBrowserProvider.download(cid)  ← IPFS
        → return encrypted blob
  → EncryptionUtility.symmetricDecrypt(blob, encryptionKey)
  → SqliteClient.initializeFromBase64(decryptedBlob)
  → Extract secretKey from Settings if not cached (ADR-006)
```

### Reading Public Ledger State (vaultCidHash)

The `vaultCidHash` is on the **public ledger** — it does NOT require a witness function or circuit call to read. In Midnight, public ledger state is queryable via the indexer's GraphQL API.

**Option A (preferred): Read from joined contract object.**
After `findDeployedContract()`, the returned contract object exposes ledger state. The exact API depends on the midnight-js-contracts version:
```typescript
// After joining:
const ledgerState = this.contract.state; // or this.contract.ledger
const cidHash = ledgerState.vaultCidHash; // Bytes<32> as Uint8Array
```

**Option B: Read directly from indexer GraphQL.**
If the contract object doesn't expose ledger directly, query the indexer:
```typescript
const query = `{ contractState(address: "${contractAddress}") { vaultCidHash } }`;
const response = await fetch(INDEXER_URL, { method: 'POST', body: JSON.stringify({ query }) });
```

**IMPORTANT:** Check the actual midnight-js-contracts API for reading public state from a joined contract. The CLI's `vault-registry-api.ts` may already have a pattern for this — look at `getLedgerState()`.

### CID Discovery for New Devices

When a new device has no local CID, it must discover the CID from Pinata:

1. Read `vaultCidHash` from on-chain public ledger (known)
2. Query Pinata pin list: `GET https://api.pinata.cloud/v3/files?status=pinned`
3. For each pinned file, SHA-256 hash the CID string
4. Compare hash with on-chain `vaultCidHash`
5. When match found → that's the vault CID

**Pinata Files API v3:**
```typescript
const response = await fetch('https://api.pinata.cloud/v3/files?status=pinned&limit=100', {
  headers: { 'Authorization': `Bearer ${this.jwt}` }
});
const result = await response.json();
// result.data.files is an array of { id, cid, ... }
```

**Performance note:** For MVP with few pins, iterating all pins is acceptable. For production, consider:
- Storing cidHash as pin metadata during upload (Story 2.3 PinataBrowserProvider.upload)
- Using Pinata's metadata search API for O(1) lookup
- Caching the pin list

### DbContext.initializeDatabase() Refactoring

The current `initializeDatabase()` takes a `VaultResponse` object (from .NET API) which includes:
- `vault.blob` — encrypted vault base64
- `vault.publicEmailDomainList`, `privateEmailDomainList`, `hiddenPrivateEmailDomainList`
- `vault.currentRevisionNumber`

The blockchain flow doesn't have email domain lists or revision numbers — these are centralized concepts. Options:

**Option A (recommended): Overload with simpler signature.**
```typescript
// New overload for blockchain flow
async initializeDatabaseFromBlob(encryptedBlob: string, encryptionKey: string): Promise<SqliteClient> {
  const decrypted = await EncryptionUtility.symmetricDecrypt(encryptedBlob, encryptionKey);
  const client = new SqliteClient();
  await client.initializeFromBase64(decrypted);
  setSqliteClient(client);
  // Store blob in background for caching
  await sendMessage('STORE_VAULT', { vaultBlob: encryptedBlob }, 'background');
  return client;
}
```

**Option B: Create minimal VaultResponse wrapper.**
Build a `VaultResponse`-shaped object with empty arrays and 0 revision number to reuse existing `initializeDatabase()`.

### secretKey Extraction on New Device (ADR-006)

After downloading and decrypting the vault on a new device, the `secretKey` must be extracted from the SQLite Settings table and cached in `VaultCidStore`:

```typescript
// After successful vault load and SQLite initialization:
const secretKeyHex = VaultCidStore.readSecretKeyFromVault(sqliteClient);
if (secretKeyHex) {
  await VaultCidStore.setSecretKey(secretKeyHex);
  // Now the device can call updateVault() on subsequent saves
}
```

This is critical for enabling saves from the new device — without the secretKey, `updateVault()` will fail the owner commitment check.

### Existing useVaultSync.ts — What to Keep, What to Replace

**Replace:**
- `webApi.getStatus()` → `readVaultCidHash()` via background message
- `webApi.get<VaultResponse>('Vault')` → IPFS download via background message
- Revision number comparison → cidHash comparison

**Keep:**
- `withMinimumDelay()` utility — still useful for UI smoothness
- `VaultSyncOptions` type — callbacks pattern works for blockchain too
- `VaultVersionIncompatibleError` handling — still needed
- `hasPendingMigrations()` check — still needed
- Error handling structure (try/catch with onError callback)

**Remove:**
- `useWebApi()` dependency (or keep for fallback during transition)
- Revision number logic
- Server status check (`serverVersion === '0.0.0'`)

### VaultMessageHandler — New Message Handler

Add `LOAD_VAULT_FROM_BLOCKCHAIN` handler that:
1. Reads cidHash from contract (via cachedContractService)
2. Compares with local VaultCidStore cidHash
3. If match → vault is current, return `{ upToDate: true }`
4. If different → download from IPFS, return `{ upToDate: false, encryptedBlob, cid, cidHash }`
5. If no registration → return `{ notRegistered: true }`

Response type:
```typescript
export type VaultLoadResponse = {
  success: boolean;
  error?: string;
  upToDate?: boolean;
  notRegistered?: boolean;
  encryptedBlob?: string;  // base64 for message passing
  cid?: string;
  cidHash?: string;
};
```

### Error Handling Strategy

| Scenario | Error | Retryable | User Action |
|----------|-------|-----------|-------------|
| Indexer unreachable | LEDGER_READ_FAILED | Yes | Auto-retry |
| Contract not deployed | VAULT_NOT_FOUND | No | Register vault first |
| No CID match in Pinata | CID_DISCOVERY_FAILED | No | Re-upload vault |
| IPFS download timeout | IPFS_DOWNLOAD_FAILED | Yes | Auto-retry |
| Decryption failure | (existing error) | No | Wrong password/key |

### Previous Story Intelligence

**From Story 2.3 (Save Flow):**
- `VaultSyncService` in `shared/vault-sync/` — extend with `loadVault()` method
- `BrowserVaultSyncProvider` pattern — create analogous `BrowserVaultLoadProvider`
- `MidnightContractService` — add `readVaultCidHash()`, cached at module level
- `PinataBrowserProvider` — `download()` exists but needs retry, add `discoverCidByHash()`
- `VaultCidStore` — already stores CID, cidHash, secretKey. Has `readSecretKeyFromVault()` method ready
- `handleUploadVaultToBlockchain()` uses `cachedContractService` — reuse same cache for load
- `VaultSyncError` with retryable flag — extend error codes for load scenarios
- Review Round 2 fix: `cachedContractService` cleared on logout — load flow benefits from this
- Browser extension imports from `@/utils/dist/shared/vault-sync` dist copy — same pattern for load additions
- `hexToUint8Array`, `bytesToHex`, `sha256`, `uint8ArrayToBase64` all available in shared utils

**From Story 2.1 (VaultRegistry Contract):**
- `vaultCidHash` is public ledger state (`Bytes<32>`)
- `owner` is public ledger state — can check if registered
- CLI `vault-registry-api.ts` has `getLedgerState()` pattern — reference for reading public state
- `createVaultRegistryPrivateState(secretKey)` needed for joining with correct secretKey
- `checkIsRegistered(walletAddressHash)` can verify registration status

**From Story 2.2 (IPFS Service):**
- `IpfsService.download(cid)` returns `Uint8Array` — shared package has this
- `withRetry` pattern in `shared/ipfs-service/src/retry.ts` — reuse pattern
- `IpfsError` with `IPFS_DOWNLOAD_FAILED` code already exists
- Pinata gateway: `https://${gateway}/files/${cid}` for download

**From Epic 1 Code Review:**
- `useWebApi()` context — may need to keep temporarily for backward compatibility
- `DbContext.initializeDatabase()` takes full `VaultResponse` — needs refactoring for blockchain flow

### Build Pattern

Follow Story 2.3 pattern exactly:
- Extend `shared/vault-sync/` (same package, not new package)
- Rebuild dist copy via `build.sh`
- Browser extension imports from `@/utils/dist/shared/vault-sync`
- Tests in `shared/vault-sync/src/__tests__/`

### SDK Versions (VERIFIED in Stories 2.1/2.2/2.3)

- compact-runtime: 0.14.0
- compact CLI: 0.4.0 (language >= 0.20)
- ledger-v7: 7.0.0
- midnight-js: 3.0.0
- wallet-sdk: 1.0.0
- pinata: 1.10.1
- Node.js: >= 18
- TypeScript: 5+
- pnpm: >= 8

### Project Structure Notes

- `shared/vault-sync/` — extend existing package (NOT new package)
- `apps/browser-extension/src/services/BrowserVaultLoadProvider.ts` — new file
- `apps/browser-extension/src/services/MidnightContractService.ts` — modify (add readVaultCidHash)
- `apps/browser-extension/src/services/PinataBrowserProvider.ts` — modify (add retry to download, add discoverCidByHash)
- `apps/browser-extension/src/entrypoints/popup/hooks/useVaultSync.ts` — major refactor
- `apps/browser-extension/src/entrypoints/background/VaultMessageHandler.ts` — add handler
- `apps/browser-extension/src/entrypoints/popup/context/DbContext.tsx` — modify initializeDatabase
- `apps/browser-extension/src/utils/types/messaging/` — add VaultLoadResponse type

### References

- [Source: _bmad-output/architecture.md#7-Multi-Device-Private-State] — CID discovery via Pinata + hash matching
- [Source: _bmad-output/architecture.md#5-IPFS-Midnight-Hybrid-Storage] — cidHash on public ledger, full CID at app layer
- [Source: _bmad-output/architecture.md#Pattern-3-IPFS-CID-Handling] — CID field naming, type handling
- [Source: _bmad-output/architecture.md#Pattern-4-Error-Handling-Standards] — AppError, retryable codes
- [Source: _bmad-output/project-context.md#Rule-2-CIDv1-Enforcement] — assertCIDv1 requirement
- [Source: _bmad-output/project-context.md#Rule-3-Shared-Business-Logic-Enforcement] — ADR-003
- [Source: _bmad-output/project-context.md#Rule-12-Midnight-Private-State-Device-Local] — ADR-006, secretKey in vault
- [Source: _bmad-output/implementation-artifacts/2-3-vault-sync-logic-save-flow.md] — Save flow architecture, review fixes
- [Source: _bmad-output/implementation-artifacts/2-1-vaultregistry-smart-contract.md] — Contract API, public ledger state
- [Source: _bmad-output/implementation-artifacts/2-2-ipfs-service-pinata.md] — IpfsService API, PinataProvider, retry
- [Source: apps/browser-extension/src/entrypoints/popup/hooks/useVaultSync.ts] — Current load flow (lines 1-160)
- [Source: apps/browser-extension/src/entrypoints/popup/context/DbContext.tsx] — initializeDatabase (lines 47-76)
- [Source: apps/browser-extension/src/services/VaultCidStore.ts] — readSecretKeyFromVault, getSecretKey
- [Source: apps/browser-extension/src/services/MidnightContractService.ts] — joinVaultRegistry, contract caching
- [Source: apps/browser-extension/src/services/PinataBrowserProvider.ts] — download(), withRetry()
- [Source: packages/blockchain/cli/src/vault-registry-api.ts] — getLedgerState pattern for reading public state

## Code Review — Round 1 (2026-02-07)

**Reviewer:** Claude Sonnet 4 (Cascade) — adversarial senior dev review
**Result:** 1 HIGH, 4 MEDIUM, 3 LOW — action items created below
**Tests:** 32/32 passing | **ACs:** All 6 implemented | **Git vs File List:** 3 undocumented changes

### Action Items

- [x] **H1: Fix stale CID on cross-device update (DATA INTEGRITY BUG)**
  - **File:** `shared/vault-sync/src/VaultSyncService.ts` lines 65-88
  - **Bug:** When on-chain cidHash differs from local cidHash, `loadVault()` reuses the stale local CID instead of discovering the new CID via Pinata. Downloads old vault version.
  - **Fix:** When hashes differ, always call `discoverCidByHash()` — never use `local.cid`. After the up-to-date check, any non-null local CID is stale.
  - **Test fix:** Update test `should download from IPFS when cidHash differs from local` to expect `discoverCidByHash` call instead of stale CID reuse. Update `source` assertion from `'local-cache'` to `'ipfs-download'`.
  - **File:** `shared/vault-sync/src/__tests__/VaultSyncService.test.ts` lines 357-370

- [x] **M1: Extract shared Pinata provider factory in VaultMessageHandler**
  - **File:** `apps/browser-extension/src/entrypoints/background/VaultMessageHandler.ts` lines 624-632, 660-671
  - **Issue:** Pinata JWT/gateway validation + `PinataBrowserProvider` creation is copy-pasted in both `handleUploadVaultToBlockchain()` and `handleLoadVaultFromBlockchain()`.
  - **Fix:** Extract `createPinataProvider()` helper function. Single place for credential validation.

- [x] **M2: Add retry to `discoverCidByHash()`**
  - **File:** `apps/browser-extension/src/services/PinataBrowserProvider.ts` line 181
  - **Issue:** `upload()` and `download()` use `withRetry()` but `discoverCidByHash()` makes raw HTTP calls without retry. Transient Pinata 5xx errors immediately fail the entire load flow.
  - **Fix:** Wrap the Pinata Files API fetch in `this.withRetry()`, consistent with other methods.

- [x] **M3: Avoid unnecessary save provider in load handler**
  - **File:** `apps/browser-extension/src/entrypoints/background/VaultMessageHandler.ts` lines 682-685
  - **Issue:** `BrowserVaultSyncProvider` instantiated just to satisfy `VaultSyncService` constructor, never used for saving. The `cachedContractService` passed may not be joined.
  - **Fix:** Consider making `VaultSyncService` constructor accept optional save provider, or create a minimal no-op provider, or make `loadVault()` a static method that doesn't require constructor injection.

- [x] **M4: Update story File List — 3 undocumented git changes**
  - `_bmad-output/implementation-artifacts/sprint-status.yaml` — modified (not in File List)
  - `apps/browser-extension/src/utils/dist/shared/vault-sync/README.md` — new file (not in File List)
  - `apps/browser-extension/src/utils/dist/shared/vault-sync/index.d.mts` — deleted (not in File List)

- [x] **L1: Remove `_onOffline` dead parameter**
  - **File:** `apps/browser-extension/src/entrypoints/popup/hooks/useVaultSync.ts` line 39, 60
  - **Issue:** Unused parameter in `VaultSyncOptions` interface and destructuring. Dead code.

- [x] **L2: Remove unused `VaultSyncConfig` interface**
  - **File:** `shared/vault-sync/src/types.ts` lines 17-20
  - **Issue:** Carried from Story 2.3 review (L1). Still unused, still unexported. Remove or defer to story that needs it.

- [x] **L3: Cache `indexerPublicDataProvider` in `readVaultCidHash()`**
  - **File:** `apps/browser-extension/src/services/MidnightContractService.ts` lines 128-131
  - **Issue:** Creates new provider instance + dynamic import resolution per call. Minor inefficiency; cache for reuse if load frequency increases.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4 (Cascade)

### Debug Log References

N/A — clean implementation, no debug cycles needed.

### Completion Notes List

1. **Task 1 — Shared package extension**: Added `VaultLoadProvider` interface (5 methods), `VaultLoadResult` type, `loadVault()` orchestrator method on `VaultSyncService`, 4 new error codes (`VAULT_NOT_FOUND`, `CID_DISCOVERY_FAILED`, `IPFS_DOWNLOAD_FAILED`, `LEDGER_READ_FAILED`). 10 new tests all passing.
2. **Task 2 — MidnightContractService.readVaultCidHash()**: Reads public ledger via `indexerPublicDataProvider` + `VaultRegistry.ledger()`. Returns null for zero-byte owner/cidHash (unregistered). Uses dynamic imports (same pattern as Story 2.3).
3. **Task 3 — PinataBrowserProvider**: download() now uses `withRetry()` for exponential backoff. `discoverCidByHash()` scans Pinata Files API v3 with pagination, SHA-256 hashes each CID, validates CIDv1 via `assertCIDv1()` before returning.
4. **Task 4 — BrowserVaultLoadProvider**: New file implementing `VaultLoadProvider`. Delegates to `MidnightContractService`, `PinataBrowserProvider`, `VaultCidStore`. Mirrors `BrowserVaultSyncProvider` pattern.
5. **Task 5 — useVaultSync.ts refactor**: Replaced centralized .NET API flow with blockchain flow. Uses `LOAD_VAULT_FROM_BLOCKCHAIN` background message. Handles notRegistered, upToDate, newVault cases. Removed `useWebApi` dependency. Kept `withMinimumDelay`, `VaultSyncOptions`, error handling patterns.
6. **Task 6 — DbContext**: Added `initializeDatabaseFromBlob()` (decrypts raw blob, no VaultResponse wrapper) and `extractAndCacheSecretKey()` (ADR-006: reads secretKey from SQLite Settings → caches in VaultCidStore).
7. **Task 7 — i18n**: Added `checkingBlockchain`, `noVaultFound`, `vaultUpToDate`, `decryptingVault` to en.json.
8. **Known lint warnings**: `@midnight-ntwrk/*` module resolution errors in MidnightContractService.ts — pre-existing from Story 2.3, resolves when SDK deps are added to browser extension.

### Implementation Plan

- **Option A chosen for DbContext** (story noted): Added `initializeDatabaseFromBlob()` as separate method rather than refactoring existing `initializeDatabase()`, to avoid breaking the legacy centralized flow during transition.
- **VaultLoadProvider as loadVault() parameter** rather than constructor injection: The save provider is required for constructor, but load provider is passed to `loadVault()` directly. This allows a single `VaultSyncService` instance to handle both save and load with different provider implementations.
- **handleSyncVault() kept as @deprecated**: Same pattern as `uploadNewVaultToServer()` — kept for backward compatibility during transition.

### File List

**New files:**
- `apps/browser-extension/src/services/BrowserVaultLoadProvider.ts`
- `apps/browser-extension/src/utils/types/messaging/VaultLoadResponse.ts`

**Modified files (shared):**
- `shared/vault-sync/src/types.ts` — added VaultLoadProvider, VaultLoadResult
- `shared/vault-sync/src/errors.ts` — added 4 load error codes
- `shared/vault-sync/src/VaultSyncService.ts` — added loadVault() method
- `shared/vault-sync/src/index.ts` — exported new types
- `shared/vault-sync/src/__tests__/VaultSyncService.test.ts` — added 10 load pipeline tests

**Modified files (browser extension):**
- `apps/browser-extension/src/services/MidnightContractService.ts` — added readVaultCidHash(), isZeroBytes(), extended VaultRegistryContract interface
- `apps/browser-extension/src/services/PinataBrowserProvider.ts` — download() retry, discoverCidByHash()
- `apps/browser-extension/src/entrypoints/background/VaultMessageHandler.ts` — added handleLoadVaultFromBlockchain()
- `apps/browser-extension/src/entrypoints/background.ts` — registered LOAD_VAULT_FROM_BLOCKCHAIN handler
- `apps/browser-extension/src/entrypoints/popup/hooks/useVaultSync.ts` — replaced centralized flow with blockchain flow
- `apps/browser-extension/src/entrypoints/popup/context/DbContext.tsx` — added initializeDatabaseFromBlob(), extractAndCacheSecretKey()
- `apps/browser-extension/src/i18n/locales/en.json` — added 4 new i18n keys

**Dist copy updated:**
- `apps/browser-extension/src/utils/dist/shared/vault-sync/index.js`
- `apps/browser-extension/src/utils/dist/shared/vault-sync/index.mjs`
- `apps/browser-extension/src/utils/dist/shared/vault-sync/index.d.ts`

**Previously undocumented (M4):**
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — modified (story status)
- `apps/browser-extension/src/utils/dist/shared/vault-sync/README.md` — copied from build
- `apps/browser-extension/src/utils/dist/shared/vault-sync/index.d.mts` — removed (tsup output changed)
