# Story 4.3: Conflict Detection & UX

Status: done

## Story

As a user saving my vault,
I want the system to detect if the vault changed since I last loaded,
so that changes from another device are merged instead of overwritten.

## Acceptance Criteria

1. Before save: fetch current CID hash from VaultRegistry on-chain (via `VaultLoadProvider.readContractCidHash()`)
2. Compare fetched hash with locally cached `lastKnownCidHash` (via `VaultCidStore.get()`)
3. If same → save normally (no conflict, existing `saveVault()` path)
4. If different → download remote vault from IPFS → decrypt → parse JSON → merge with local vault using `resolveVaultConflict()` from Story 4.2
5. Show notification after merge: "Vault synced: Added X credentials, updated Y" (non-blocking toast or status message)
6. Merged vault is uploaded as the new vault (automatic — no manual user review step for MVP)
7. `VaultSyncService` extended with `saveWithConflictCheck()` method that encapsulates the detect-merge-save pipeline
8. Race condition documented: no atomic compare-and-swap on VaultRegistry. Acceptable for MVP.

## Tasks / Subtasks

- [x] **Task 1: Add `saveWithConflictCheck()` to VaultSyncService** (AC: 1-4, 7, 8)
  - [x] 1.1 Add new method signature: `saveWithConflictCheck(localVaultJson: string, encryptionKey: string, loadProvider: VaultLoadProvider): Promise<ConflictCheckResult>`
  - [x] 1.2 Define `ConflictCheckResult` type in `shared/vault-sync/src/types.ts`: `{ cid: string; cidHash: string; merged: boolean; summary?: MergeSummary }`
  - [x] 1.3 Implement conflict detection: call `loadProvider.readContractCidHash()`, compare with `loadProvider.getLocalCid().cidHash`
  - [x] 1.4 No-conflict path: delegate to existing `saveVault()` with the encrypted local vault
  - [x] 1.5 Conflict path: download remote via `loadProvider.downloadFromIpfs()` + `loadProvider.discoverCidByHash()`, decrypt with `EncryptionUtility.symmetricDecrypt()`, parse JSON, call `resolveVaultConflict(localVault, remoteVault)`, encrypt merged vault, save via `saveVault()`
  - [x] 1.6 Export `ConflictCheckResult` and `MergeSummary` (re-export) from `shared/vault-sync/src/index.ts`
  - [x] 1.7 Add `MERGE_DECRYPT_FAILED` and `MERGE_FAILED` error codes to `VaultSyncErrorCodes`

- [x] **Task 2: Add decryption capability to VaultSyncService** (AC: 4)
  - [x] 2.1 `saveWithConflictCheck` needs to decrypt the remote vault to merge it — the method receives the `encryptionKey` (string) as a parameter
  - [x] 2.2 Import `resolveVaultConflict` from `@aliasvault/vault-types` in `VaultSyncService.ts`
  - [x] 2.3 The caller (background handler) passes `encryptionKey` — the service doesn't access storage directly
  - [x] 2.4 Use a new `decrypt` function parameter or a `VaultConflictProvider` sub-interface to keep VaultSyncService platform-agnostic (it must NOT import browser-specific `EncryptionUtility` directly)

- [x] **Task 3: Wire `saveWithConflictCheck()` into background handler** (AC: 1-6)
  - [x] 3.1 In `VaultMessageHandler.ts`, update `handleUploadVaultToBlockchain()` to use `saveWithConflictCheck()` instead of `saveVault()`
  - [x] 3.2 Pass the `encryptionKey` from `handleGetEncryptionKey()` and a `BrowserVaultLoadProvider` instance
  - [x] 3.3 Return `ConflictCheckResult` (includes `merged` boolean and optional `MergeSummary`) in `VaultUploadResponse`
  - [x] 3.4 Add `merged?: boolean` and `mergeSummary?: { added: number; updated: number; deleted: number }` fields to `VaultUploadResponse` type
  - [x] 3.5 When merge occurs: update `cachedVaultStore` and `cachedVaultBlob` with the merged vault (cache invalidation)
  - [x] 3.6 When merge occurs: update `session:encryptedVault` in storage with the merged encrypted blob

- [x] **Task 4: Surface merge notification in popup UI** (AC: 5)
  - [x] 4.1 In `useVaultMutate.ts`, read `merged` and `mergeSummary` from `VaultUploadResponse`
  - [x] 4.2 When `merged === true`, set a merge status message: e.g. `"Vault synced: Added 2, updated 1 credentials from another device"`
  - [x] 4.3 Add i18n key `common.vaultMerged` with interpolation: `"Vault synced: Added {{added}}, updated {{updated}} credentials from another device"`
  - [x] 4.4 Show via existing `syncStatus` state (non-blocking — appears in the save progress indicator)
  - [x] 4.5 ~~If merge occurs during `useVaultSync` (load-time), reload VaultStore with merged vault data so UI reflects merged state~~ — N/A: Dev Notes explicitly prohibit load-time merge logic. Save-time merge updates `session:encryptedVault` and clears cache; next access uses merged data.

- [x] **Task 5: Unit tests for saveWithConflictCheck** (AC: 1-4, 7)
  - [x] 5.1 Create `shared/vault-sync/src/__tests__/saveWithConflictCheck.test.ts`
  - [x] 5.2 Test: no conflict (hashes match) → delegates to `saveVault()`, `merged: false`
  - [x] 5.3 Test: conflict detected → downloads remote, decrypts, merges, re-encrypts, saves merged vault, `merged: true` with correct `MergeSummary`
  - [x] 5.4 Test: conflict but remote download fails → throws `VaultSyncError` with `IPFS_DOWNLOAD_FAILED`
  - [x] 5.5 Test: conflict but remote decrypt fails → throws `VaultSyncError` with `MERGE_DECRYPT_FAILED`
  - [x] 5.6 Test: on-chain hash read fails → throws `VaultSyncError` with `LEDGER_READ_FAILED`
  - [x] 5.7 Test: no local CID cached (first save) → skip conflict check, proceed with save
  - [x] 5.8 Test: merged vault is uploaded (not the original local vault)

- [x] **Task 6: TypeScript verification** (AC: 1-8)
  - [x] 6.1 Run `tsc --noEmit` in `shared/vault-sync/` — zero errors
  - [x] 6.2 Run `tsc --noEmit` in `shared/vault-types/` — zero errors (dependency)
  - [x] 6.3 Run `pnpm test` in `shared/vault-sync/` — all tests pass
  - [x] 6.4 Run `tsc --noEmit` in `apps/browser-extension/` — zero errors (verify ambient types in `externals.d.ts` still resolve)

## Dev Notes

### What This Story Is

Wire Story 4.2's `resolveVaultConflict()` into the save pipeline. Before every vault upload, check if the on-chain CID hash changed since last load. If it did, download the remote vault, merge with local, and upload the merged result. The user sees a brief status message about what was merged.

### Architecture Compliance

**Section 3 (Conflict Resolution Strategy), lines 389-401:**
- Before save, compare on-chain cidHash with cached cidHash
- If different, fetch remote vault → decrypt → merge → upload merged
- Show notification: "Changes merged: Added X, updated Y"

**Pattern 5 (Conflict Resolution Flow):**
- Conflict check at save time (not load time for this story — load-time check already exists in `useVaultSync`)
- Use credential-level merge (Story 4.2's `resolveVaultConflict`)
- Non-blocking notification after merge

**Known MVP limitation (documented in Architecture):**
No atomic compare-and-swap on VaultRegistry. Race condition between CID check and save is possible but unlikely given human interaction timing.

### Key Design Decision: Where to Put Merge Logic

`saveWithConflictCheck()` lives in `VaultSyncService` (shared package), NOT in the browser extension. This keeps the merge pipeline platform-agnostic. The browser extension provides:
- `VaultLoadProvider` — reads on-chain hash, downloads from IPFS
- `VaultSyncProvider` — uploads to IPFS, updates contract
- `encryptionKey` — for decrypting remote vault
- A `decrypt` function or provider — since `EncryptionUtility` is in the browser extension

**Platform-agnostic decryption pattern:** `saveWithConflictCheck` accepts a `decrypt: (encryptedBytes: Uint8Array, key: string) => Promise<string>` callback. The browser extension passes a wrapper around `EncryptionUtility.symmetricDecrypt`. This avoids importing browser-specific crypto into the shared package.

Similarly, it needs an `encrypt: (plaintext: string, key: string) => Promise<Uint8Array>` callback to re-encrypt the merged vault before upload.

### Current Save Flow (Before This Story)

```
useVaultMutate → syncVault() → operation() → encrypt → UPLOAD_VAULT → handleUploadVaultToBlockchain()
                                                                           ↓
                                                                    VaultSyncService.saveVault(encryptedBytes)
                                                                           ↓
                                                                    IPFS upload → hash CID → update contract → persist CID
```

### New Save Flow (After This Story)

```
useVaultMutate → syncVault() → operation() → encrypt → UPLOAD_VAULT → handleUploadVaultToBlockchain()
                                                                           ↓
                                                              VaultSyncService.saveWithConflictCheck(...)
                                                                           ↓
                                                         readContractCidHash() vs getLocalCid()
                                                           ↓ same                    ↓ different
                                                   saveVault(encrypted)     download remote → decrypt →
                                                                            resolveVaultConflict(local, remote) →
                                                                            encrypt merged → saveVault(mergedEncrypted)
                                                                                    ↓
                                                                    return { merged: true, summary: MergeSummary }
```

### Existing Code to Reuse (DO NOT reinvent)

| What | Where | How |
|------|-------|-----|
| `resolveVaultConflict()` | `shared/vault-types/src/mergeVault.ts` | Import from `@aliasvault/vault-types` |
| `MergeSummary`, `MergeResult` | `shared/vault-types/src/types.ts` | Import from `@aliasvault/vault-types` |
| `VaultSyncService.saveVault()` | `shared/vault-sync/src/VaultSyncService.ts` | Call from within `saveWithConflictCheck()` |
| `VaultSyncService.loadVault()` | Same file | Reuse load logic for downloading remote vault |
| `VaultSyncError`, error codes | `shared/vault-sync/src/errors.ts` | Extend with 2 new codes |
| `VaultLoadProvider` interface | `shared/vault-sync/src/types.ts` | Passed to `saveWithConflictCheck()` |
| `BrowserVaultLoadProvider` | `apps/browser-extension/src/services/BrowserVaultLoadProvider.ts` | Passed from background handler |
| `BrowserVaultSyncProvider` | `apps/browser-extension/src/services/BrowserVaultSyncProvider.ts` | Already used by `handleUploadVaultToBlockchain` |
| `VaultCidStore` | `apps/browser-extension/src/services/VaultCidStore.ts` | Read by `BrowserVaultLoadProvider.getLocalCid()` |
| `EncryptionUtility.symmetricDecrypt/Encrypt` | `apps/browser-extension/src/utils/EncryptionUtility.ts` | Passed as callbacks, not imported directly |
| `createPinataProvider()` | `VaultMessageHandler.ts:581` | Already exists in background handler |
| `cachedContractService` | `VaultMessageHandler.ts:574` | Already manages MidnightContractService lifecycle |
| `base64ToUint8Array`, `uint8ArrayToBase64` | `shared/vault-sync/src/utils.ts` | For base64 ↔ Uint8Array conversion |

### Files to Create

| File | Purpose |
|------|---------|
| `shared/vault-sync/src/__tests__/saveWithConflictCheck.test.ts` | Unit tests for conflict detection + merge pipeline |

### Files to Modify

| File | Changes |
|------|---------|
| `shared/vault-sync/src/VaultSyncService.ts` | Add `saveWithConflictCheck()` method |
| `shared/vault-sync/src/types.ts` | Add `ConflictCheckResult` type |
| `shared/vault-sync/src/errors.ts` | Add `MERGE_DECRYPT_FAILED`, `MERGE_FAILED` error codes |
| `shared/vault-sync/src/index.ts` | Export new types + re-export `MergeSummary` |
| `apps/browser-extension/src/entrypoints/background/VaultMessageHandler.ts` | Wire `saveWithConflictCheck()` into upload handler |
| `apps/browser-extension/src/utils/types/messaging/VaultUploadResponse.ts` | Add `merged`, `mergeSummary` fields |
| `apps/browser-extension/src/entrypoints/popup/hooks/useVaultMutate.ts` | Read merge result, show merge notification |
| i18n translation files | Add `common.vaultMerged` key |

### What NOT To Do

- **DO NOT** add conflict detection to `loadVault()` — the existing `useVaultSync` already handles load-time sync (downloads new vault if CID differs). This story adds conflict detection to the **save** path only.
- **DO NOT** import `EncryptionUtility` in `shared/vault-sync/` — it's browser-specific. Use callback/provider pattern.
- **DO NOT** add a manual review step or confirmation dialog — MVP auto-merges and notifies. Architecture says "User reviews merged vault before final upload" but for MVP this is automatic (manual review is a V2 refinement).
- **DO NOT** add `chrome.notifications.create()` for merge notifications — use the existing `syncStatus` state in `useVaultMutate`. Browser notifications are noisy and not needed for MVP.
- **DO NOT** modify `resolveVaultConflict()` or its tests (Story 4.2 code is frozen, in review).
- **DO NOT** add load-time merge logic to `useVaultSync` — keep this story scoped to save-time conflict detection only. Load-time already reloads from remote when CID differs.
- **DO NOT** create `ConflictResolver.tsx` component — the architecture lists it but MVP uses a status message, not a full UI component.

### Testing Strategy

Unit tests in `shared/vault-sync/` mock all providers:
- `VaultSyncProvider` — mock `uploadToIpfs`, `updateContractCidHash`, `persistCid`
- `VaultLoadProvider` — mock `readContractCidHash`, `getLocalCid`, `downloadFromIpfs`, `discoverCidByHash`, `persistCid`
- `decrypt` callback — mock to return decrypted JSON string
- `encrypt` callback — mock to return encrypted Uint8Array

No browser extension integration tests in this story (would require full WXT test harness). The background handler changes are wiring-only and verified by `tsc --noEmit`.

### Workspace Topology (Rule 24)

- `shared/vault-sync/` is in `pnpm-workspace.yaml` → can use `workspace:*` deps
- `shared/vault-sync/` already depends on `@aliasvault/vault-types` — verify in `package.json`, add if missing
- `apps/browser-extension/` is NOT in `pnpm-workspace.yaml` — uses `src/utils/dist/shared/` copy pattern
- If `shared/vault-sync/` exports change, ensure `apps/browser-extension/src/types/externals.d.ts` ambient declarations still cover the new types

### Ambient Declaration Check (Rule 24)

`apps/browser-extension/src/types/externals.d.ts` declares `@aliasvault/vault-sync` ambient types. After adding `ConflictCheckResult` and re-exporting `MergeSummary`, verify the ambient declaration still matches. If using a typed declaration (not `declare module '*'`), update it.

### Edge Cases

1. **First save ever (no local CID):** `getLocalCid()` returns `{ cid: null, cidHash: null }`. Skip conflict check, proceed directly to save.
2. **On-chain hash read fails:** Throw `VaultSyncError` with `LEDGER_READ_FAILED` (same as `loadVault`).
3. **CID discovery fails after hash mismatch:** Throw `CID_DISCOVERY_FAILED`. The save is aborted — user must retry.
4. **Remote vault decrypt fails:** Throw `MERGE_DECRYPT_FAILED`. Could mean password changed on other device — surface as user-facing error.
5. **Merge produces empty summary:** Still save the merged vault (could happen if remote has no meaningful changes but CID differs due to re-encryption).

### Previous Story Intelligence (Story 4.2)

- `resolveVaultConflict()` is in `shared/vault-types/src/mergeVault.ts`, exported from `@aliasvault/vault-types`
- Returns `MergeResult = { merged: VaultJson; summary: MergeSummary }`
- `MergeSummary` has `added`, `updated`, `deleted`, `kept` arrays of credential IDs
- The function operates on raw `VaultJson` objects — caller handles encrypt/decrypt
- 22 unit tests pass, covering all merge scenarios
- `VaultStore.fromJson(jsonString)` parses JSON string → VaultStore; `VaultStore.toJson()` → JSON string

### Git Intelligence

Recent commits (Story 4.2):
- `shared/vault-types/src/mergeVault.ts` — new merge function
- `shared/vault-types/src/types.ts` — `MergeSummary`, `MergeResult` types added
- `shared/vault-types/src/index.ts` — exports updated
- Pattern: clean separation of pure functions in `shared/vault-types/`, no browser deps

### Project Structure Notes

- All shared library changes in `shared/vault-sync/` — existing package
- Browser extension changes are wiring-only (background handler + hooks + types)
- No new packages or workspace topology changes
- Rule 24 compliance: verify ambient declarations after export changes

### References

- [Source: _bmad-output/architecture.md#Section-3] — Conflict resolution strategy, `saveWithConflictCheck()` reference
- [Source: _bmad-output/architecture.md#Pattern-5] — Conflict resolution flow, trigger points, notification pattern
- [Source: _bmad-output/project-planning-artifacts/epics.md#Story-4.3] — Epic AC and known limitations
- [Source: shared/vault-sync/src/VaultSyncService.ts] — Existing `saveVault()` and `loadVault()` implementations
- [Source: shared/vault-sync/src/types.ts] — `VaultSyncProvider`, `VaultLoadProvider` interfaces
- [Source: shared/vault-types/src/mergeVault.ts] — `resolveVaultConflict()` from Story 4.2
- [Source: shared/vault-types/src/types.ts] — `VaultJson`, `MergeSummary`, `MergeResult` types
- [Source: apps/browser-extension/src/entrypoints/background/VaultMessageHandler.ts:592-614] — `handleUploadVaultToBlockchain()` current implementation
- [Source: apps/browser-extension/src/entrypoints/popup/hooks/useVaultMutate.ts] — Current mutation + upload flow
- [Source: apps/browser-extension/src/entrypoints/popup/hooks/useVaultSync.ts] — Current load-time sync flow
- [Source: apps/browser-extension/src/services/BrowserVaultLoadProvider.ts] — Load provider implementation
- [Source: apps/browser-extension/src/services/BrowserVaultSyncProvider.ts] — Save provider implementation
- [Source: apps/browser-extension/src/services/VaultCidStore.ts] — Local CID persistence
- [Source: _bmad-output/implementation-artifacts/4-2-credential-level-merge.md] — Previous story context
- [Source: _bmad-output/project-context.md#Rule-23] — JSON vault format enforcement
- [Source: _bmad-output/project-context.md#Rule-24] — Workspace topology + ambient declarations

## Change Log

- **2026-03-04:** Story 4.3 implemented — saveWithConflictCheck() on VaultSyncService, wired into background handler, merge notification in UI, 8 unit tests, all tsc clean.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- vault-types dist needed rebuild before vault-sync tests could resolve `resolveVaultConflict`
- `@aliasvault/models` needed as transitive dependency + `paths` mapping in vault-sync tsconfig (models has sub-path exports without `exports` field in package.json)
- vault-sync dist copy to browser-extension required after adding `saveWithConflictCheck` (Rule 24 copy pattern)

### Completion Notes List

- Task 1+2: `saveWithConflictCheck()` added to VaultSyncService with platform-agnostic `decrypt`/`encrypt` callback pattern. Method accepts `localVaultJson`, `encryptionKey`, `loadProvider`, `decrypt`, `encrypt` — no browser-specific imports in shared package.
- Task 3: `handleUploadVaultToBlockchain()` rewired from `saveVault()` to `saveWithConflictCheck()`. Decrypts local vault to JSON, creates EncryptionUtility wrapper callbacks, passes BrowserVaultLoadProvider. Cache invalidation on merge (clears cachedVaultStore/cachedVaultBlob, updates session:encryptedVault).
- Task 4: `useVaultMutate` reads `merged`/`mergeSummary` from response, shows i18n `common.vaultMerged` message via existing `syncStatus`. No load-time merge logic added per Dev Notes.
- Task 5: 8 unit tests in `saveWithConflictCheck.test.ts` — no-conflict, conflict-merge, download fail, decrypt fail, ledger fail, first save skip, merged vault upload, no-provider error. All pass.
- Task 6: tsc --noEmit zero errors in vault-sync, vault-types, browser-extension. 106 tests pass in vault-sync, 81 in vault-types.

**Code Review Follow-ups (2026-03-04):**
- H1: Added 3-second display delay for merge notification via `mergeOccurredRef` in `useVaultMutate` `finally` block
- H2: Added `ENCRYPT_FAILED` error code and `encryptOrThrow()` private helper — all 3 encrypt calls now wrapped in `VaultSyncError`
- M1: Task 4.5 annotated as N/A with explanation (Dev Notes prohibit load-time merge logic)
- M2: Added `ConflictCheckResult` and `MergeSummary` to `externals.d.ts` ambient declaration
- M3: Added `preDecryptedJson` optional parameter to `handleUploadVaultToBlockchain` — `handleCreateIdentity` passes pre-decrypted JSON, eliminates redundant decrypt/encrypt round-trip
- L1: Added `pnpm-lock.yaml` and `externals.d.ts` to File List
- L2: Added `deleted` count to merge notification i18n string and `useVaultMutate` display

### File List

**Created:**
- `shared/vault-sync/src/__tests__/saveWithConflictCheck.test.ts`

**Modified:**
- `shared/vault-sync/src/VaultSyncService.ts` — added `saveWithConflictCheck()` method, import `resolveVaultConflict`
- `shared/vault-sync/src/types.ts` — added `ConflictCheckResult` interface
- `shared/vault-sync/src/errors.ts` — added `MERGE_DECRYPT_FAILED`, `MERGE_FAILED` error codes
- `shared/vault-sync/src/index.ts` — export `ConflictCheckResult`, re-export `MergeSummary`
- `shared/vault-sync/package.json` — added `@aliasvault/vault-types` and `@aliasvault/models` dependencies
- `shared/vault-sync/tsconfig.json` — added `paths` mapping for `@aliasvault/models/*`
- `apps/browser-extension/src/entrypoints/background/VaultMessageHandler.ts` — rewired upload to use `saveWithConflictCheck()`
- `apps/browser-extension/src/utils/types/messaging/VaultUploadResponse.ts` — added `merged`, `mergeSummary` fields
- `apps/browser-extension/src/entrypoints/popup/hooks/useVaultMutate.ts` — read merge result, show notification
- `apps/browser-extension/src/i18n/locales/en.json` — added `common.vaultMerged` key
- `apps/browser-extension/src/utils/dist/shared/vault-sync/index.{js,mjs,d.ts,d.mts}` — rebuilt dist copy
- `apps/browser-extension/src/types/externals.d.ts` — added ConflictCheckResult, MergeSummary ambient types
- `pnpm-lock.yaml` — updated from dependency additions
