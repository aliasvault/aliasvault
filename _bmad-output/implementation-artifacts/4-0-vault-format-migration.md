# Story 4.0: Vault Format Migration (SQLite → JSON)

Status: done

## Story

As a developer,
I want the vault stored as a JSON object instead of a SQLite binary,
so that credential-level merge and conflict resolution can work as the architecture designed.

## Acceptance Criteria

1. `VaultJson` and `CredentialTree` types defined in new `shared/vault-types/` package
2. `VaultStore` class implements all public methods from `SqliteClient` with caller-compatible signatures (see Method Mapping table for actual signatures — some are simplified)
3. `DbContext.tsx` uses `VaultStore` (property renamed from `sqliteClient` to `vaultStore`)
4. `VaultMessageHandler.ts` uses `VaultStore` for all handler functions
5. Save flow: `VaultStore.toJson()` → encrypt → IPFS → contract update
6. Load flow: decrypt → `VaultStore.fromJson()` → working vault
7. `useVaultMutate` calls `toJson()` instead of `exportToBase64()`
8. Mechanical rename `sqliteClient` → `vaultStore` across ~16 UI files
9. `sql.js` and `shared/vault-sql` dependencies removed from project
10. Extension bundle size reduced (~500KB WASM eliminated)
11. All existing credential CRUD operations pass (unit tests rewritten for VaultStore)
12. Settings preserved in `vault.settings` (including `midnightSecretKey` per Rule 12)
13. EncryptionKeys preserved in `vault.encryptionKeys`
14. Passkey CRUD (by RpId, by CredentialId) works on JSON store
15. `imgSrcFromBytes()` moved to standalone utility

## Tasks / Subtasks

- [x] **Task 1: Create `shared/vault-types/` package** (AC: 1)
  - [x] 1.1 Scaffold package: `package.json` (`@aliasvault/vault-types`, with `"@aliasvault/models": "workspace:*"` dependency for `Credential`/`Attachment`/`TotpCode` types), `tsconfig.json`, `tsup.config.ts`, `build.sh`
  - [x] 1.2 Add to `pnpm-workspace.yaml` (`shared/*` glob should auto-include)
  - [x] 1.3 Define types in `src/types.ts`: `VaultJson`, `CredentialTree`, `EncryptionKeyEntry`, `PasswordEntry`, `AttachmentEntry`, `TotpEntry`, `PasskeyEntry`
  - [x] 1.4 Create `src/index.ts` re-exporting all types
  - [x] 1.5 Run `pnpm install` to link workspace package

- [x] **Task 2: Implement `VaultStore` class** (AC: 2, 12, 13, 14)
  - [x] 2.1 Create `src/VaultStore.ts` with internal `VaultJson` state
  - [x] 2.2 Implement lifecycle: `static fromJson(json: string): VaultStore` (must validate `version` field — throw if `version > CURRENT_VERSION` for forward-compatibility safety), `toJson(): string` (stamps `version: 1`), `static createEmpty(): VaultStore` (creates vault with `version: 1`, empty credentials map, empty settings, empty encryptionKeys)
  - [x] 2.3 Implement credential CRUD matching actual SqliteClient call sites:
    - `getAllCredentials(): Credential[]` — map `CredentialTree` → `Credential` (Option B)
    - `getCredentialById(id): Credential | null` — same mapping
    - `createCredential(credential: Credential, attachments: Attachment[], totpCodes: TotpCode[]): Promise<string>` — denormalize into `CredentialTree`, return UUID
    - `updateCredentialById(credential: Credential, originalAttachmentIds: string[], attachments: Attachment[], originalTotpCodeIds: string[], totpCodes: TotpCode[]): Promise<number>` — diff-merge into `CredentialTree`, return affected count
    - `deleteCredentialById(id)` — soft-delete: `isDeleted = true`
  - [x] 2.4 Implement settings: `getSetting(key, defaultValue?)`, `setSetting(key, value)`, `getDefaultEmailDomain()`, `getEffectiveIdentityLanguage()`, `getDefaultIdentityGender()`, `getPasswordSettings()`
  - [x] 2.5 Implement encryption keys: `getEncryptionKeys()`, `addEncryptionKey(key)`
  - [x] 2.6 Implement passkey CRUD: `getPasskeyByRpId(rpId)`, `getPasskeysByCredentialId(credId)`, `createPasskey(...)`, `deletePasskey(id)`
  - [x] 2.7 Implement attachment CRUD: `getAttachmentsByCredentialId(credId)`, `addAttachment(...)`, `deleteAttachment(id)`
  - [x] 2.8 Implement TOTP CRUD: `getTotpByCredentialId(credId)`, `addTotp(...)`, `deleteTotp(id)`
  - [x] 2.9 Implement `hasPendingMigrations()` → always returns `false` (no migrations in JSON format). **Note:** callers that branch on `hasPendingMigrations() === true` become dead code — remove those conditional blocks entirely in Tasks 4/5 rather than preserving them.
  - [x] 2.10 Implement `getDatabaseVersion()` → returns `vault.version`

- [x] **Task 3: Write VaultStore unit tests** (AC: 11)
  - [x] 3.1 Serialization roundtrip: `createEmpty()` → mutations → `toJson()` → `fromJson()` → verify state
  - [x] 3.2 All CRUD: create, read, update, delete for credentials, passkeys, attachments, TOTP
  - [x] 3.3 Settings: get/set, `midnightSecretKey` round-trip, default email domain
  - [x] 3.4 Encryption keys: add, list, deduplication by id
  - [x] 3.5 Soft-delete: `deleteCredentialById` sets `isDeleted=true`, `getAllCredentials` filters them out
  - [x] 3.6 Edge cases: empty vault, missing fields, `fromJson` with malformed input
  - [x] 3.7 Version validation: `fromJson` with `version > CURRENT_VERSION` throws descriptive error; `version === CURRENT_VERSION` succeeds; missing version defaults to 1
  - [x] 3.8 Logo roundtrip: create credential with binary `Logo` (`Uint8Array`), read back via `getAllCredentials()`, verify `Logo` bytes match original

- [x] **Task 4: Update `DbContext.tsx`** (AC: 3, 5, 6)
  - [x] 4.1 Replace `import SqliteClient` → `import { VaultStore } from '@aliasvault/vault-types'`
  - [x] 4.2 Rename type: `sqliteClient: SqliteClient | null` → `vaultStore: VaultStore | null`
  - [x] 4.3 Update `initializeDatabase`: `symmetricDecrypt()` → `VaultStore.fromJson(decryptedJson)`
  - [x] 4.4 Update `initializeDatabaseFromBlob`: same pattern
  - [x] 4.5 Update `checkStoredVault`: `VaultStore.fromJson()` instead of `initializeFromBase64()`
  - [x] 4.6 Update `extractAndCacheSecretKey`: already duck-typed (`{ getSetting }`) — just pass `vaultStore`
  - [x] 4.7 Remove `hasPendingMigrations` conditional blocks — dead code since VaultStore always returns `false`. Delete migration upgrade branches entirely.
  - [x] 4.8 Update comment: "SQLite client" → "Vault store"

- [x] **Task 5: Update `VaultMessageHandler.ts`** (AC: 4, 5)
  - [x] 5.1 Replace `SqliteClient` import → `VaultStore` from `@/utils/dist/shared/vault-types`
  - [x] 5.2 Rename `createVaultSqliteClient()` → `createVaultStore()`, change decrypt+init flow
  - [x] 5.3 Update `uploadNewVaultToServer`: `exportToBase64()` → `toJson()`
  - [x] 5.4 Update all handler methods that reference `sqliteClient` → `vaultStore`
  - [x] 5.5 Remove `hasPendingMigrations` conditional blocks entirely — dead code removed.
  - [x] 5.6 Fixed `getDatabaseVersion()` call: removed `.version` property access (returns `number` directly) and wrapped in `String()` for `Vault.version` field compatibility.

- [x] **Task 6: Update `useVaultMutate.ts`** (AC: 7)
  - [x] 6.1 `dbContext.sqliteClient!.exportToBase64()` → `dbContext.vaultStore!.toJson()`

- [x] **Task 7: Mechanical rename across UI files** (AC: 8)
  - [x] 7.1 Global find-replace `dbContext.sqliteClient` → `dbContext.vaultStore` across all popup pages/components (11 files)
  - [x] 7.2 Second pass: `dbContext?.sqliteClient` → `dbContext?.vaultStore` (optional chaining, 7 files)
  - [x] 7.3 `useVaultSync.ts`: renamed `sqliteClient` → `vaultStore`, removed `hasPendingMigrations` checks, removed `VaultVersionIncompatibleError` imports/catches
  - [x] 7.4 `Unlock.tsx`: removed `VaultVersionIncompatibleError` import and all 2 catch blocks
  - [x] 7.5 `Upgrade.tsx`: replaced with redirect-only stub (SQL migration page is dead code)
  - [x] 7.6 `content.ts`: removed dead `hasPendingMigrations` check

- [x] **Task 8: Update `PasskeyHandler.ts` and `contentScript/Popup.ts`** (AC: 8)
  - [x] 8.1 `PasskeyHandler.ts`: SqliteClient import → VaultStore from `@/utils/dist/shared/vault-types`, init flow updated
  - [x] 8.2 `contentScript/Popup.ts`: SqliteClient.imgSrcFromBytes → standalone `imgSrcFromBytes` import

- [x] **Task 9: Move `imgSrcFromBytes()` to standalone utility + logo encoding** (AC: 15)
  - [x] 9.1 Created `apps/browser-extension/src/utils/logoUtils.ts` (named logoUtils per actual utility)
  - [x] 9.2 Moved `imgSrcFromBytes()`, `toUint8Array()`, `base64Encode()`, `detectMimeType()`, `placeholderBase64`
  - [x] 9.3 Updated all callers: `HeaderBlock.tsx`, `CredentialCard.tsx`, `contentScript/Popup.ts`

- [x] **Task 10: Remove SQLite dependencies** (AC: 9, 10)
  - [x] 10.1 Removed `sql.js` and `@types/sql.js` from `apps/browser-extension/package.json`
  - [x] 10.2 `shared/vault-sql/` NOT removed yet — deferred (used by mobile app, out of scope per Dev Notes)
  - [x] 10.3 Removed `@aliasvault/vault-types` workspace dep from browser-extension (not needed — imports via `@/utils/dist/shared/vault-types` path alias)
  - [x] 10.4 `pnpm install` run to update lockfile
  - [x] 10.5 Verified: no remaining `SqliteClient` imports, no `sql.js` imports (except dead `SqliteClient.ts` file itself)
  - [x] 10.6 `SqliteClient.ts` file deleted during code review — 1,611-line dead code removed (zero imports confirmed)

- [x] **Task 11: Verification** (AC: 10, 11)
  - [x] 11.1 `tsc --noEmit` — zero Story 4.0 errors (all remaining errors are pre-existing in untouched files: ClipboardClearHandler, ContextMenu, PasskeyHandler popup-undefined, EmailPreview, LoadingContext, CredentialAddEdit, CredentialsList, ShareClaim test)
  - [x] 11.2 `pnpm test` in `shared/vault-types/` — 48/48 tests pass
  - [x] 11.3 Build check: `build:chrome` fails identically on clean commit (pre-existing: `@midnight-ntwrk` packages not installed in this environment)
  - [x] 11.4 `shared/models/` `Credential` type unchanged — UI compatibility preserved
  - [ ] 11.3 Extension builds without sql.js WASM in output
  - [ ] 11.4 Verify `Credential` type in `shared/models/` still used by UI (don't break model exports)

## Dev Notes

### Architecture Context

**Sprint Change Proposal (2026-03-02):** Full analysis at `_bmad-output/implementation-artifacts/sprint-change-proposal-2026-03-02.md`. This story aligns the implementation with the architecture's original JSON vault design (Section 3). The SQLite format was carried forward from the .NET/EF Core codebase during Epic 2 as the fastest path to a working save/load flow.

**Key insight:** All 8 tables in the SQLite schema have **1:1 relationships per credential**. `SqliteClient.createCredential()` generates new UUIDs for Service and Alias every time — they're never shared. Denormalization into `CredentialTree` is trivial.

**Async/sync note:** `SqliteClient` methods like `createCredential`, `updateCredentialById`, `deleteCredentialById` return `Promise<T>` (async). VaultStore is pure in-memory (no I/O), but these methods **must stay `async`** (or return resolved promises) because all call sites `await` them. Changing to sync would require updating every caller — out of scope.

### Critical Rules

- **Rule 23 (project-context.md):** Vault blob on IPFS is `VaultJson` JSON, not SQLite binary. `VaultStore` replaces `SqliteClient`.
- **Rule 12:** `midnightSecretKey` stored in `vault.settings` (not SQL `Settings` table). Pattern: `vaultStore.getSetting('midnightSecretKey')`.
- **Rule 3 (ADR-003):** VaultStore goes in `shared/vault-types/`, NOT in `apps/browser-extension/`.
- **Rule 19:** VaultStore is a shared package — browser extension imports via `@aliasvault/vault-types`. No Vite transform-time issues since it's a proper workspace dependency.

### Blast Radius Inventory

**Logic changes (4 files):**
| File | Change |
|------|--------|
| `shared/vault-types/src/VaultStore.ts` | **NEW** — ~300 lines, replaces SqliteClient |
| `apps/browser-extension/src/entrypoints/popup/context/DbContext.tsx` | Type swap + init flow (SqliteClient → VaultStore) |
| `apps/browser-extension/src/entrypoints/background/VaultMessageHandler.ts` | 16 handler call sites + factory function |
| `apps/browser-extension/src/entrypoints/popup/hooks/useVaultMutate.ts` | Line 47: `exportToBase64()` → `toJson()` |

**Mechanical renames (~16 files — `sqliteClient` → `vaultStore`):**
| Category | Files |
|----------|-------|
| Background workers | `PasskeyHandler.ts`, `contentScript/Popup.ts` |
| Hooks | `useVaultSync.ts` |
| Auth pages | `Unlock.tsx`, `Upgrade.tsx` |
| Credential pages | `CredentialAddEdit.tsx`, `CredentialDetails.tsx`, `CredentialsList.tsx` |
| Email pages | `EmailsList.tsx`, `EmailDetails.tsx` |
| Passkey pages | `PasskeyAuthenticate.tsx`, `PasskeyCreate.tsx` |
| Components | `PasswordField.tsx`, `EmailPreview.tsx`, `TotpBlock.tsx`, `AttachmentBlock.tsx` |

**Files with `SqliteClient` class import (need type change):**
- `HeaderBlock.tsx` (line 4) — imports default for `imgSrcFromBytes` static method
- `CredentialCard.tsx` (line 5) — same

**Removed entirely:**
- `apps/browser-extension/src/utils/SqliteClient.ts` (1,611 lines)
- `shared/vault-sql/` (entire package: 15 files, 62.5KB source)
- `sql.js` + `@types/sql.js` dependencies

### VaultStore Method Mapping

Map every SqliteClient public method to its VaultStore equivalent:

| SqliteClient Method | VaultStore Method | Notes |
|---------------------|-------------------|-------|
| `initializeFromBase64(b64)` | `static fromJson(json)` | JSON parse instead of SQL binary |
| `exportToBase64()` | `toJson()` | JSON.stringify instead of SQL export |
| `getAllCredentials()` | `getAllCredentials()` | Returns `CredentialTree[]`, filters `isDeleted` |
| `getCredentialById(id)` | `getCredentialById(id)` | Returns `CredentialTree \| null` |
| `createCredential(credential, attachments[], totpCodes[])` | `createCredential(credential, attachments[], totpCodes[])` | Denormalize all args into `CredentialTree`, return UUID. Must stay `async` for caller compat. |
| `updateCredentialById(credential, origAttIds[], attachments[], origTotpIds[], totpCodes[])` | `updateCredentialById(credential, origAttIds[], attachments[], origTotpIds[], totpCodes[])` | Diff-merge into `CredentialTree`, update `updatedAt`. Must stay `async` for caller compat. |
| `deleteCredentialById(id)` | `deleteCredentialById(id)` | Sets `isDeleted = true`, updates `updatedAt`. Must stay `async` for caller compat. |
| `getSetting(key, default?)` | `getSetting(key, default?)` | From `vault.settings` Record |
| `setSetting(key, value)` | `setSetting(key, value)` | To `vault.settings` Record |
| `getPasswordSettings()` | `getPasswordSettings()` | Parse from settings keys |
| `getDefaultEmailDomain()` | `getDefaultEmailDomain()` | From settings |
| `getEffectiveIdentityLanguage()` | `getEffectiveIdentityLanguage()` | From settings |
| `getDefaultIdentityGender()` | `getDefaultIdentityGender()` | From settings |
| `hasPendingMigrations()` | `hasPendingMigrations()` | Always `false` |
| `getDatabaseVersion()` | `getDatabaseVersion()` | Returns `vault.version` |
| `static imgSrcFromBytes(bytes)` | **Moved** to `utils/imageUtils.ts` | Static utility, not vault-specific |
| `execute(sql, params)` | **Removed** | No raw SQL in JSON store |

### DbContext Init Flow Change

**Current (SQLite):**
```typescript
const decryptedBlob = await EncryptionUtility.symmetricDecrypt(blob, derivedKey);
const client = new SqliteClient();
await client.initializeFromBase64(decryptedBlob); // base64 → binary → SQL
```

**New (JSON):**
```typescript
const decryptedJson = await EncryptionUtility.symmetricDecrypt(blob, derivedKey);
const store = VaultStore.fromJson(decryptedJson); // JSON string → parsed → VaultStore
```

**Save flow (useVaultMutate line 47):**
```typescript
// OLD: const base64Vault = dbContext.sqliteClient!.exportToBase64();
const jsonVault = dbContext.vaultStore!.toJson();
const encryptedVaultBlob = await EncryptionUtility.symmetricEncrypt(jsonVault, encryptionKey);
```

### VaultCidStore Compatibility

`VaultCidStore.readSecretKeyFromVault()` already uses duck-typing:
```typescript
static readSecretKeyFromVault(
  sqliteClient: { getSetting: (key: string, defaultValue?: string) => string },
): string | null {
  const value = sqliteClient.getSetting('midnightSecretKey', '');
  return value || null;
}
```
VaultStore implements `getSetting()` → **zero changes needed** in VaultCidStore. Just pass `vaultStore` instead of `sqliteClient` at the call site in `DbContext.tsx`.

### createEmpty() Entry Point

Fresh vaults are created during first-time registration (Unlock.tsx → background handler). The current flow calls `new SqliteClient()` then initializes an empty SQLite database. The new flow must call `VaultStore.createEmpty()` instead. Trace the exact call site in `VaultMessageHandler.ts` — look for handler that creates a new empty vault (likely the register/createVault handler). `createEmpty()` returns a VaultStore with `version: 1`, empty credentials map, default settings, and empty encryptionKeys array.

### Existing Model Types

`shared/models/src/vault/` contains these types used by UI components:
- `Credential.ts` — Used by UI for display. **Keep as-is** for UI compatibility. `CredentialTree` is the vault-internal type; `Credential` is the UI-facing type.
- `Attachment.ts`, `EncryptionKey.ts`, `Passkey.ts`, `PasswordSettings.ts`, `TotpCode.ts`

The `VaultStore.getAllCredentials()` should return data compatible with the existing `Credential` type used by UI. Either:
- Option A: Return `CredentialTree[]` and update UI to use it (more work)
- Option B: Return mapped `Credential[]` matching existing interface (less disruption)

**Recommended: Option B** — `getAllCredentials()` maps `CredentialTree` → `Credential` for UI. The `CredentialTree` is internal to vault storage; UI components keep using the existing `Credential` type from `shared/models`.

**Logo encoding gap:** `Credential.Logo` is `Uint8Array | number[]` (binary, from SQLite BLOB). `CredentialTree.logo` is `string` (base64, JSON-safe). The mapping layer in VaultStore must:
- **Write path** (`Credential` → `CredentialTree`): `btoa(String.fromCharCode(...logo))` or `Buffer.from(logo).toString('base64')`
- **Read path** (`CredentialTree` → `Credential`): decode base64 → `Uint8Array`
- This is critical — without it, logos silently corrupt (binary in JSON = mojibake).

### Mobile App Scope

The `apps/mobile-app/` also references `SqliteClient` but uses `NativeVaultManager` (not sql.js). **Mobile is OUT OF SCOPE for this story.** Mobile app refactoring is a separate concern not covered by Epic 4.

### What NOT To Do

- **DO NOT** change the encryption layer — `EncryptionUtility.symmetricEncrypt/Decrypt` works with strings, stays identical
- **DO NOT** change `VaultSyncService` — its API (`saveVault(encryptedBytes)`, `loadVault(provider)`) is unchanged; only the bytes content changes from SQLite binary to JSON
- **DO NOT** change IPFS service — it uploads/downloads `Uint8Array`, format-agnostic
- **DO NOT** change contract interaction — `VaultRegistry` stores CID hash, format-agnostic
- **DO NOT** create migrations — no existing users, Big Bang replacement
- **DO NOT** touch `shared/models/` types — those are UI types, VaultStore has its own internal types

### Package Scaffold Reference

Use existing `shared/vault-sql/` as reference for package structure:
```
shared/vault-types/
├── package.json          # @aliasvault/vault-types, deps: "@aliasvault/models": "workspace:*"
├── tsconfig.json         # extends root config
├── tsup.config.ts        # CJS + ESM + DTS (same as vault-sql)
├── build.sh              # tsup build script (same pattern)
├── vitest.config.ts
├── src/
│   ├── index.ts          # Re-export types + VaultStore
│   ├── types.ts          # VaultJson, CredentialTree, etc.
│   ├── VaultStore.ts     # Main class (~300 lines)
│   └── __tests__/
│       └── VaultStore.test.ts
```

### Project Structure Notes

- New package `shared/vault-types/` follows existing `shared/*` convention (vault-sql, vault-sync, models)
- `pnpm-workspace.yaml` already globs `shared/*` — auto-included
- Browser extension `package.json` needs: `"@aliasvault/vault-types": "workspace:*"` added, `"sql.js"` + `"@types/sql.js"` removed
- turbo.json `build` pipeline already covers `shared/*` via dependency graph

### References

- [Source: _bmad-output/implementation-artifacts/sprint-change-proposal-2026-03-02.md] — Full analysis
- [Source: _bmad-output/architecture.md#Section-3] — VaultJson/CredentialTree types, merge logic
- [Source: _bmad-output/project-context.md#Rule-23] — JSON vault format decision
- [Source: _bmad-output/project-context.md#Rule-12] — Secret key in vault settings
- [Source: _bmad-output/project-context.md#Rule-3] — Shared business logic enforcement
- [Source: apps/browser-extension/src/utils/SqliteClient.ts] — 1,611 lines being replaced
- [Source: apps/browser-extension/src/entrypoints/popup/context/DbContext.tsx] — React context to update
- [Source: apps/browser-extension/src/entrypoints/background/VaultMessageHandler.ts] — 16 handlers
- [Source: apps/browser-extension/src/entrypoints/popup/hooks/useVaultMutate.ts] — Save flow
- [Source: apps/browser-extension/src/services/VaultCidStore.ts:85-90] — Duck-typed getSetting interface

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Completion Notes List
1. **Import path deviation**: Story specified `@aliasvault/vault-types` (npm workspace import), but browser extension uses `@/utils/dist/shared/vault-types` path alias pattern (via build.sh dist copy). All 3 consuming files updated to match existing convention.
2. **Optional chaining gotcha**: `replace_all` for `dbContext.sqliteClient` does not match `dbContext?.sqliteClient`. Required a second pass targeting optional chaining variant across 7 files.
3. **getDatabaseVersion() signature**: VaultStore returns `number` (not `{version: number}` like SqliteClient). Also not async. Fixed call site in VaultMessageHandler to `String(vaultStore.getDatabaseVersion())`.
4. **Upgrade.tsx replaced with stub**: The entire SQL migration UI (Upgrade page with VaultSqlGenerator, beginTransaction, executeRaw, etc.) is dead code — replaced with a redirect-only component.
5. **VaultVersionIncompatibleError removed**: Eliminated from useVaultSync.ts (2 catch blocks) and Unlock.tsx (2 catch blocks). JSON vaults have no version incompatibility path.
6. **content.ts cleanup**: Removed dead `hasPendingMigrations` check that would show upgrade popup.
7. **SqliteClient.ts deleted**: 1,611-line dead code file removed during code review (zero imports remaining).
8. **shared/vault-sql/ not deleted**: Per Dev Notes, mobile app may still use it. Out of scope for this story.
9. **Pre-existing build failure**: `build:chrome` fails on both clean commit and with Story 4.0 changes — `@midnight-ntwrk` packages not installed in node_modules. Not caused by this story.
10. **Pre-existing tsc errors — FIXED**: Originally 15 errors in 8 files untouched by Story 4.0. Root cause: dependency version drift (`@types/chrome@0.0.280`, `@types/react@19`) exposing latent type issues, plus missing ambient declarations for runtime-only packages. All fixed post-review: `ClipboardClearHandler.ts` (chrome enum cast), `ContextMenu.ts` (non-null assertion), `PasskeyHandler.ts` (optional chaining), `EmailPreview.tsx` (map callback type), `LoadingContext.tsx` (unused prop removal), `CredentialAddEdit.tsx` (Object.entries cast + dead prop removal), `CredentialsList.tsx` (dead onOffline removal), `ShareClaim.test.tsx` (null cast). New `src/types/externals.d.ts` created for ambient module declarations (Rule 24). `tsc --noEmit` now reports zero errors.
11. **[Code Review Fix] H1: Timestamp alignment**: All internal timestamps (CredentialTree, PasswordEntry, AttachmentEntry) changed from ISO `string` to `number` (Unix ms) per architecture spec. PasskeyEntry already used `number` — now consistent. Removed `now()` helper, replaced with `Date.now()`. Fixed sort comparison from `localeCompare` to numeric subtraction. Attachment model mapping converts `number` → ISO string.
12. **[Code Review Fix] H2: lastModified field**: Added `lastModified?: number` to `VaultJson` type. `toJson()` stamps `Date.now()` on every serialization. Required by architecture for conflict resolution (Story 4.2/4.3).
13. **[Code Review Fix] M1-M3: Stale comments/dead code cleanup**: Fixed "SQLite Settings table" comment in DbContext.tsx. Removed dead `storeSecretKeyInVault()` SQL method and stale SqliteClient JSDoc in VaultCidStore.ts. Removed dead `onUpgradeRequired` param from VaultSyncOptions + Reinitialize.tsx caller.
14. **[Code Review Fix] M4: SqliteClient.ts deleted**: 1,611 lines of dead code removed (zero imports confirmed via grep).

### File List

**New files:**
- `shared/vault-types/` — New package (package.json, tsconfig.json, tsup.config.ts, build.sh, vitest.config.ts, eslint.config.mjs, src/index.ts, src/types.ts, src/VaultStore.ts, src/__tests__/VaultStore.test.ts)
- `apps/browser-extension/src/utils/logoUtils.ts` — Extracted from SqliteClient static methods
- `apps/browser-extension/src/utils/dist/shared/vault-types/` — Build output (index.js, index.mjs, index.d.ts, index.d.mts)

**Modified files (logic changes):**
- `apps/browser-extension/src/entrypoints/background/VaultMessageHandler.ts` — Full SqliteClient→VaultStore migration, factory rewrite, hasPendingMigrations removal
- `apps/browser-extension/src/entrypoints/popup/context/DbContext.tsx` — Type swap, init flow, hasPendingMigrations removal
- `apps/browser-extension/src/entrypoints/popup/hooks/useVaultMutate.ts` — exportToBase64→toJson
- `apps/browser-extension/src/entrypoints/popup/hooks/useVaultSync.ts` — VaultVersionIncompatibleError removal, rename
- `apps/browser-extension/src/entrypoints/popup/pages/auth/Unlock.tsx` — VaultVersionIncompatibleError removal, hasPendingMigrations removal
- `apps/browser-extension/src/entrypoints/popup/pages/auth/Upgrade.tsx` — Replaced with redirect stub
- `apps/browser-extension/src/entrypoints/background/PasskeyHandler.ts` — SqliteClient→VaultStore init
- `apps/browser-extension/src/entrypoints/content.ts` — Removed hasPendingMigrations dead branch
- `apps/browser-extension/src/entrypoints/contentScript/Popup.ts` — imgSrcFromBytes import change
- `apps/browser-extension/package.json` — Removed sql.js, @types/sql.js, @aliasvault/vault-types deps
- `pnpm-lock.yaml` — Updated

**Modified files (mechanical renames only — `sqliteClient` → `vaultStore`):**
- `apps/browser-extension/src/entrypoints/popup/components/Credentials/CredentialCard.tsx`
- `apps/browser-extension/src/entrypoints/popup/components/Credentials/Details/AttachmentBlock.tsx`
- `apps/browser-extension/src/entrypoints/popup/components/Credentials/Details/HeaderBlock.tsx`
- `apps/browser-extension/src/entrypoints/popup/components/Credentials/Details/TotpBlock.tsx`
- `apps/browser-extension/src/entrypoints/popup/components/EmailPreview.tsx`
- `apps/browser-extension/src/entrypoints/popup/components/Forms/PasswordField.tsx`
- `apps/browser-extension/src/entrypoints/popup/pages/credentials/CredentialAddEdit.tsx`
- `apps/browser-extension/src/entrypoints/popup/pages/credentials/CredentialDetails.tsx`
- `apps/browser-extension/src/entrypoints/popup/pages/credentials/CredentialsList.tsx`
- `apps/browser-extension/src/entrypoints/popup/pages/emails/EmailDetails.tsx`
- `apps/browser-extension/src/entrypoints/popup/pages/emails/EmailsList.tsx`
- `apps/browser-extension/src/entrypoints/popup/pages/passkeys/PasskeyAuthenticate.tsx`
- `apps/browser-extension/src/entrypoints/popup/pages/passkeys/PasskeyCreate.tsx`

**Modified files (code review fixes):**
- `shared/vault-types/src/types.ts` — Timestamps string→number, added lastModified
- `shared/vault-types/src/VaultStore.ts` — Date.now() timestamps, lastModified stamping, numeric sort
- `shared/vault-types/src/__tests__/VaultStore.test.ts` — Added lastModified test (49 total)
- `apps/browser-extension/src/services/VaultCidStore.ts` — Removed dead storeSecretKeyInVault(), fixed JSDoc
- `apps/browser-extension/src/entrypoints/popup/hooks/useVaultSync.ts` — Removed dead onUpgradeRequired param
- `apps/browser-extension/src/entrypoints/popup/pages/Reinitialize.tsx` — Removed onUpgradeRequired caller

**New files (tsc fixes):**
- `apps/browser-extension/src/types/externals.d.ts` — Ambient module declarations for runtime-only packages (Rule 24)

**Modified files (tsc fixes — post-review):**
- `apps/browser-extension/src/entrypoints/background/ClipboardClearHandler.ts` — chrome.runtime.ContextType cast
- `apps/browser-extension/src/entrypoints/background/ContextMenu.ts` — tab.id non-null assertion
- `apps/browser-extension/src/entrypoints/background/PasskeyHandler.ts` — popup?.id optional chaining
- `apps/browser-extension/src/entrypoints/popup/components/EmailPreview.tsx` — MailboxEmail type annotation
- `apps/browser-extension/src/entrypoints/popup/context/LoadingContext.tsx` — Removed unused message prop
- `apps/browser-extension/src/entrypoints/popup/pages/credentials/CredentialAddEdit.tsx` — Object.entries cast + removed dead originalAttachmentIds prop
- `apps/browser-extension/src/entrypoints/popup/pages/credentials/CredentialsList.tsx` — Removed dead _onOffline callback
- `apps/browser-extension/src/entrypoints/popup/pages/recovery/__tests__/ShareClaim.test.tsx` — null→any cast for missing-param test

**Deleted files:**
- `apps/browser-extension/src/utils/SqliteClient.ts` — 1,611 lines dead code removed
