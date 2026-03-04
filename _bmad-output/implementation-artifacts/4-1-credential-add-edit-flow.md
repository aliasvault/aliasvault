# Story 4.1: Credential Add/Edit Flow

Status: done

## Story

As a user,
I want to add or edit credentials in my vault,
so that my login information is securely stored on the blockchain.

## Acceptance Criteria

1. Credential add form (service name, username, password, alias email, notes) works with VaultStore
2. Credential edit form updates existing credential via VaultStore
3. Credential delete sets `isDeleted: true` on CredentialTree
4. `createdAt` and `updatedAt` timestamps set correctly on all CRUD operations
5. On save: VaultStore mutation → vault sync → IPFS upload → contract update
6. Success/error feedback in UI unchanged
7. Credential IDs use UUIDs (existing `crypto.randomUUID()` pattern)

## Tasks / Subtasks

- [x] **Task 1: Migrate `handleCreateIdentity` to blockchain save flow** (AC: 5)
  - [x] 1.1 In `VaultMessageHandler.ts`, replace `uploadNewVaultToServer(vaultStore)` call in `handleCreateIdentity()` with the blockchain upload pattern: `vaultStore.toJson()` → `EncryptionUtility.symmetricEncrypt()` → `handleUploadVaultToBlockchain(encryptedBase64)`. Return `{ success: true }` on success.
  - [x] 1.2 Update `handleCreateIdentity` return type or response to include CID/cidHash if callers need it (check `contentScript/Popup.ts` — currently ignores response data beyond success/error).
  - [x] 1.3 Update session storage: after successful blockchain upload, persist the newly encrypted vault blob to `session:encryptedVault` and update `cachedVaultBlob` (same pattern as `uploadNewVaultToServer` lines 685-693 but without the centralized API call).

- [x] **Task 2: Migrate content script sync to blockchain flow** (AC: 5)
  - [x] 2.1 In `contentScript/Popup.ts` line 239, replace `sendMessage('SYNC_VAULT', ...)` with `sendMessage('LOAD_VAULT_FROM_BLOCKCHAIN', ...)`. Handle the `VaultLoadResponse` return shape (check for `success`, `notRegistered`, `upToDate` — for the content script create flow, we only need to ensure the cached vault is fresh).
  - [x] 2.2 Verify: if `notRegistered` (new user with no vault), the content script should still allow credential creation (creates a fresh vault). Trace how `createVaultStore()` handles the empty-vault case — it should fall through to `VaultStore.createEmpty()`.

- [x] **Task 3: Remove deprecated `uploadNewVaultToServer()`** (AC: 5)
  - [x] 3.1 After Tasks 1-2, grep for remaining callers of `uploadNewVaultToServer`. If zero callers remain, delete the function (lines ~671-725 in VaultMessageHandler.ts).
  - [x] 3.2 If `WebApiService` import in VaultMessageHandler is now unused, remove it. **Do NOT remove `WebApiService` itself** — it's still used by `handleSyncVault`, `WebApiContext`, `MobileLoginUtility`, and `MobileUnlockModal`.
  - [x] 3.3 If `handleSyncVault` (centralized revision-based sync) is now unreachable from any code path, mark it as deprecated with a comment. **Do NOT delete** — other entry points may still use `SYNC_VAULT` message.

- [x] **Task 4: Verify CRUD timestamp correctness** (AC: 4)
  - [x] 4.1 Add VaultStore unit tests (in `shared/vault-types/src/__tests__/VaultStore.test.ts`) for timestamp behavior:
    - `createCredential`: verify `createdAt === updatedAt`, both are `number` (Unix ms), and are recent
    - `updateCredentialById` (field change): verify `updatedAt > createdAt`, `createdAt` unchanged
    - `updateCredentialById` (password change): verify `password.updatedAt` updated, `password.createdAt` preserved
    - `updateCredentialById` (no changes): verify `updatedAt` still bumped (any update call = touch)
    - `deleteCredentialById`: verify `updatedAt` bumped, `isDeleted === true`
    - Attachment soft-delete: verify `att.updatedAt` bumped when attachment removed via `originalAttachmentIds` diff
  - [x] 4.2 Verify `toJson()` stamps `lastModified` on the `VaultJson` envelope (already implemented — just add assertion in existing serialization roundtrip test)

- [x] **Task 5: Verify end-to-end popup CRUD flow** (AC: 1, 2, 3, 6, 7)
  - [x] 5.1 Trace the popup create flow: `CredentialAddEdit.tsx` → `executeVaultMutation()` → `vaultStore.createCredential()` → `toJson()` → encrypt → `sendMessage('UPLOAD_VAULT')` → `handleUploadVaultToBlockchain()`. Confirm no dead paths.
  - [x] 5.2 Trace the popup edit flow: `CredentialAddEdit.tsx` (edit mode) → `vaultStore.updateCredentialById()` → same upload path. Confirm attachment and TOTP diff logic works (original IDs vs current IDs).
  - [x] 5.3 Trace the popup delete flow: `CredentialAddEdit.tsx` → `handleDelete()` → `vaultStore.deleteCredentialById()` → same upload path. Confirm soft-delete sets `isDeleted: true`.
  - [x] 5.4 Confirm UUID generation: `createCredential` uses `crypto.randomUUID().toUpperCase()`.

- [x] **Task 6: TypeScript verification** (AC: 1-7)
  - [x] 6.1 Run `tsc --noEmit` in `apps/browser-extension/` — zero new errors
  - [x] 6.2 Run `pnpm test` in `shared/vault-types/` — all tests pass (currently 49 + new timestamp tests)

## Dev Notes

### What This Story Is

This is a **validation and migration** story, not a "build new UI" story. The credential CRUD UI already works after Story 4.0's VaultStore migration. The work here is:
1. Fix the **content script create path** which still uses the deprecated centralized API
2. Verify and test timestamp behavior
3. Clean up dead code

### Critical Context from Story 4.0

Story 4.0 migrated all vault operations from `SqliteClient` to `VaultStore`. The popup-side CRUD flow (`CredentialAddEdit.tsx` → `useVaultMutate` → `UPLOAD_VAULT` → blockchain) is **already working**. The gap is the content script's inline popup (`contentScript/Popup.ts`) which bypasses the popup and creates credentials via a separate `CREATE_IDENTITY` message handler.

### The Two Create Paths

**Path A: Popup form (already correct)**
```
CredentialAddEdit.tsx
  → executeVaultMutation(async () => vaultStore.createCredential(...))
  → useVaultMutate: toJson() → encrypt → sendMessage('UPLOAD_VAULT')
  → VaultMessageHandler.handleUploadVault()
  → handleUploadVaultToBlockchain()
  → VaultSyncService.saveVault() (IPFS + contract)
```

**Path B: Content script inline popup (NEEDS FIX)**
```
contentScript/Popup.ts
  → sendMessage('SYNC_VAULT')              ← DEPRECATED: centralized API sync
  → sendMessage('CREATE_IDENTITY', {...})
  → VaultMessageHandler.handleCreateIdentity()
  → uploadNewVaultToServer(vaultStore)      ← DEPRECATED: centralized API upload
```

**Target for Path B (after this story):**
```
contentScript/Popup.ts
  → sendMessage('LOAD_VAULT_FROM_BLOCKCHAIN')  ← Blockchain sync
  → sendMessage('CREATE_IDENTITY', {...})
  → VaultMessageHandler.handleCreateIdentity()
  → handleUploadVaultToBlockchain(encryptedBase64)  ← Blockchain upload
```

### `handleCreateIdentity` Migration Pattern

Current (deprecated):
```typescript
// VaultMessageHandler.ts:359-381
export async function handleCreateIdentity(message: any): Promise<messageBoolResponse> {
  const vaultStore = await createVaultStore();
  await vaultStore.createCredential(message.credential, message.attachments || []);
  await uploadNewVaultToServer(vaultStore);  // ← DEPRECATED centralized API
  return { success: true };
}
```

Target (blockchain flow):
```typescript
export async function handleCreateIdentity(message: any): Promise<messageBoolResponse> {
  const encryptionKey = await handleGetEncryptionKey();
  if (!encryptionKey) {
    return { success: false, error: await t('common.errors.vaultIsLocked') };
  }
  const vaultStore = await createVaultStore();
  await vaultStore.createCredential(message.credential, message.attachments || []);

  // Encrypt and upload via blockchain (same pattern as handleUploadVault)
  const vaultJson = vaultStore.toJson();
  const encryptedVault = await EncryptionUtility.symmetricEncrypt(vaultJson, encryptionKey);
  await storage.setItems([{ key: 'session:encryptedVault', value: encryptedVault }]);
  cachedVaultBlob = encryptedVault;

  await handleUploadVaultToBlockchain(encryptedVault);
  return { success: true };
}
```

Note: `handleUploadVaultToBlockchain` expects a base64 string. Verify `EncryptionUtility.symmetricEncrypt()` returns base64. Check how `handleUploadVault` converts: line 507 does `base64ToUint8Array(encryptedVaultBase64)` — so yes, the encrypted string is base64-encoded.

### Content Script Sync Migration

The content script Popup.ts (line 239) calls `SYNC_VAULT` which uses the centralized `WebApiService.getStatus()` to check vault revision. Replace with `LOAD_VAULT_FROM_BLOCKCHAIN` which checks the on-chain CID hash via `VaultSyncService`.

The `LOAD_VAULT_FROM_BLOCKCHAIN` handler returns `VaultLoadResponse`:
```typescript
type VaultLoadResponse = {
  success: boolean;
  error?: string;
  notRegistered?: boolean;  // New user, no vault on-chain
  upToDate?: boolean;       // Cached vault matches on-chain CID
  encryptedBlob?: string;   // New vault blob from IPFS (if CID changed)
}
```

For the content script, the response handling is simpler than the popup's `useVaultSync` — just fire and continue. If `notRegistered` or `upToDate`, proceed with create. If new blob available, the background handler already updates the cached vault.

### Files Modified

| File | Change |
|------|--------|
| `apps/browser-extension/src/entrypoints/background/VaultMessageHandler.ts` | Migrate `handleCreateIdentity` to blockchain flow; remove `uploadNewVaultToServer`; remove unused `WebApiService` import if applicable |
| `apps/browser-extension/src/entrypoints/contentScript/Popup.ts` | Replace `SYNC_VAULT` with `LOAD_VAULT_FROM_BLOCKCHAIN` |
| `shared/vault-types/src/__tests__/VaultStore.test.ts` | Add timestamp verification tests |

### What NOT To Do

- **DO NOT** change the popup CRUD flow (`CredentialAddEdit.tsx` → `useVaultMutate`) — it already works
- **DO NOT** remove `WebApiService` class or `WebApiContext` — still used by other flows
- **DO NOT** remove `handleSyncVault` — mark deprecated if unreachable, but keep for safety
- **DO NOT** add `CreatedAt`/`UpdatedAt` to `Credential` UI type — the UI `HeaderBlock` doesn't display dates; timestamps are for internal merge logic (Story 4.2)
- **DO NOT** change `VaultStore` CRUD method signatures — they're already correct
- **DO NOT** touch the encryption layer — `EncryptionUtility.symmetricEncrypt/Decrypt` is unchanged

### Existing Test Coverage (49 tests pass)

VaultStore already has comprehensive CRUD tests (Story 4.0). This story adds **timestamp-specific** assertions. The existing tests cover:
- Serialization roundtrip (`createEmpty` → mutations → `toJson` → `fromJson`)
- All CRUD: create, read, update, delete for credentials, passkeys, attachments, TOTP
- Settings: get/set, `midnightSecretKey` round-trip
- Encryption keys: add, list, deduplication
- Soft-delete: `isDeleted` filter, version validation
- Logo encoding roundtrip (binary → base64 → binary)

### Project Structure Notes

- All changes are within `apps/browser-extension/` and `shared/vault-types/` — both in existing package scope
- No new packages or dependencies
- No `pnpm-workspace.yaml` changes
- Rule 24 (`externals.d.ts`) — no changes needed; `handleUploadVaultToBlockchain` is already in VaultMessageHandler
- Rule 19 (Vite import constraint) — not applicable; all changes are in background script (not TSX)
- Rule 23 (JSON vault format) — this story validates compliance

### References

- [Source: _bmad-output/implementation-artifacts/4-0-vault-format-migration.md] — Previous story context
- [Source: _bmad-output/implementation-artifacts/sprint-change-proposal-2026-03-02.md#Section-4] — Epic 4 revision
- [Source: _bmad-output/project-planning-artifacts/epics.md#Story-4.1] — Epic AC
- [Source: _bmad-output/architecture.md#Section-3] — Conflict resolution strategy, VaultJson types
- [Source: _bmad-output/project-context.md#Rule-23] — JSON vault format enforcement
- [Source: apps/browser-extension/src/entrypoints/background/VaultMessageHandler.ts:359-381] — `handleCreateIdentity` (deprecated centralized flow)
- [Source: apps/browser-extension/src/entrypoints/background/VaultMessageHandler.ts:667-725] — `uploadNewVaultToServer` (deprecated)
- [Source: apps/browser-extension/src/entrypoints/contentScript/Popup.ts:239] — `SYNC_VAULT` (deprecated centralized sync)
- [Source: apps/browser-extension/src/entrypoints/contentScript/Popup.ts:306] — `CREATE_IDENTITY` caller
- [Source: apps/browser-extension/src/entrypoints/popup/hooks/useVaultMutate.ts] — Correct blockchain save flow
- [Source: apps/browser-extension/src/entrypoints/popup/hooks/useVaultSync.ts] — Correct blockchain sync flow

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

None — clean implementation, no debugging needed.

### Completion Notes List

- **Task 1**: Migrated `handleCreateIdentity` from deprecated `uploadNewVaultToServer()` (centralized API) to blockchain flow: `toJson()` → `symmetricEncrypt()` → persist session storage + `cachedVaultBlob` → `handleUploadVaultToBlockchain()`. Content script caller ignores response beyond success/error — no CID return needed.
- **Task 2**: Replaced `SYNC_VAULT` with `LOAD_VAULT_FROM_BLOCKCHAIN` in content script Popup.ts. Fire-and-continue pattern per Dev Notes — content script doesn't process `VaultLoadResponse`. Empty-vault case safe because user is already logged in with vault in session by the time content script popup is visible.
- **Task 3**: Deleted `uploadNewVaultToServer()` (zero callers remaining). Removed dead imports `Vault` and `VaultPostResponse` from webapi types. `WebApiService` import kept (still used by `handleSyncVault`). Marked `handleSyncVault` as `@deprecated` — zero `SYNC_VAULT` senders remain but handler registration kept in background.ts for safety.
- **Task 4**: Added 8 timestamp-specific unit tests (7 in new "Timestamp behavior" describe block + 1 lastModified roundtrip assertion). All 57 tests pass (49 original + 8 new).
- **Task 5**: End-to-end popup flow traced (create, edit, delete). All paths verified — no dead paths. Attachment/TOTP diff logic confirmed. UUID generation uses `crypto.randomUUID().toUpperCase()` consistently.
- **Task 6**: `tsc --noEmit` zero errors. `pnpm test` 57/57 pass.

### Change Log

- 2026-03-04: Story 4.1 implementation — migrated content script create path to blockchain, removed deprecated centralized API code, added timestamp verification tests.
- 2026-03-04: Code review fixes — M1: preserve error details in handleCreateIdentity catch block; M2: check CREATE_IDENTITY response before closing popup. L3 (Logo Uint8Array corruption) investigated and found to be a non-issue — `toLogo()` already handles the JSON round-trip plain-object case.

### Senior Developer Review (AI)

**Reviewer:** Amelia (Dev Agent) | **Date:** 2026-03-04 | **Outcome:** Approved (after fixes)

**Findings (5 total):**
- **M1** [FIXED]: `handleCreateIdentity` catch block swallowed blockchain error details — now preserves `error.message` (VaultMessageHandler.ts:385)
- **M2** [FIXED]: Content script ignored `CREATE_IDENTITY` response — now checks `success` and throws on failure (Popup.ts:306-312)
- **L1** [DEFERRED]: `SYNC_VAULT` handler is dead code (background.ts:45) — zero callers remain. Kept per story spec.
- **L2** [PRE-EXISTING]: Content script doesn't check `LOAD_VAULT_FROM_BLOCKCHAIN` response (Popup.ts:239)
- **L3** [NOT A BUG]: `JSON.parse(JSON.stringify(Uint8Array))` → plain object handled by `toLogo()` at VaultStore.ts:28-30

**Verification:** 57/57 tests pass, `tsc --noEmit` clean.

### File List

- `apps/browser-extension/src/entrypoints/background/VaultMessageHandler.ts` — Migrated `handleCreateIdentity` to blockchain flow; deleted `uploadNewVaultToServer`; removed dead `Vault`/`VaultPostResponse` imports; marked `handleSyncVault` deprecated; M1: preserve error details in catch block
- `apps/browser-extension/src/entrypoints/contentScript/Popup.ts` — Replaced `SYNC_VAULT` with `LOAD_VAULT_FROM_BLOCKCHAIN`; M2: check CREATE_IDENTITY response status before closing popup
- `shared/vault-types/src/__tests__/VaultStore.test.ts` — Added 8 timestamp verification tests + lastModified roundtrip assertion
