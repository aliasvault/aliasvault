# Story 4.2: Credential-Level Merge

Status: done

## Story

As a user syncing from multiple devices,
I want credential-level merge,
so that I don't lose changes from other devices.

## Acceptance Criteria

1. `resolveVaultConflict(local: VaultJson, remote: VaultJson)` returns `{ merged: VaultJson; summary: MergeSummary }`
2. New credentials on remote only: added to merged vault (summary: `added`)
3. New credentials on local only: kept in merged vault (summary: `kept`)
4. Same credential modified on both sides: last-write-wins via `updatedAt` comparison
5. Deletion conflicts: if local `isDeleted=true` but remote has later `updatedAt` → remote wins (user can delete again)
6. Simultaneous new credentials with same service+username: both kept (different UUIDs — no dedup)
7. Settings merge: remote wins per key (spread: `{ ...local.settings, ...remote.settings }`)
8. EncryptionKeys merge: union by `id` (deduplicate, keep all unique keys)
9. Merged vault version = `Math.max(local.version, remote.version)`, `lastModified = Date.now()`
10. Return `MergeSummary` with `added`, `updated`, `deleted`, `kept` arrays of credential IDs
11. Unit tests for all merge scenarios: add, update, delete conflict, simultaneous create, settings, encryption keys, edge cases

## Tasks / Subtasks

- [x] **Task 1: Define MergeSummary type and resolveVaultConflict signature** (AC: 1, 10)
  - [x] 1.1 In `shared/vault-types/src/types.ts`, add `MergeSummary` type: `{ added: string[]; updated: string[]; deleted: string[]; kept: string[] }`
  - [x] 1.2 In `shared/vault-types/src/types.ts`, add `MergeResult` type: `{ merged: VaultJson; summary: MergeSummary }`
  - [x] 1.3 Export both types from `shared/vault-types/src/index.ts`

- [x] **Task 2: Implement resolveVaultConflict()** (AC: 1-9)
  - [x] 2.1 Create `shared/vault-types/src/mergeVault.ts` with function `resolveVaultConflict(local: VaultJson, remote: VaultJson): MergeResult`
  - [x] 2.2 Credential merge loop — iterate `allIds = new Set([...Object.keys(local.credentials), ...Object.keys(remote.credentials)])`:
    - Remote-only (`!localCred`): `merged[id] = remoteCred`, push to `summary.added`
    - Local-only (`!remoteCred`): `merged[id] = localCred`, push to `summary.kept`
    - Both exist: compare `updatedAt` — higher wins, push to `summary.updated` or `summary.kept`
    - Deletion conflict: if one side `isDeleted=true` and other has later `updatedAt` → later timestamp wins. If deleted side has later `updatedAt` → push to `summary.deleted`
  - [x] 2.3 Settings merge: `{ ...local.settings, ...remote.settings }` (remote wins per key)
  - [x] 2.4 EncryptionKeys merge: build `Map<id, EncryptionKeyEntry>` from local, then overlay remote — `[...keyMap.values()]`
  - [x] 2.5 Set merged `version = Math.max(local.version, remote.version)`, `lastModified = Date.now()`
  - [x] 2.6 Export `resolveVaultConflict` from `shared/vault-types/src/index.ts`

- [x] **Task 3: Unit tests for credential merge scenarios** (AC: 2-6, 11)
  - [x] 3.1 Create `shared/vault-types/src/__tests__/mergeVault.test.ts`
  - [x] 3.2 Test: remote-only credential → appears in merged, summary.added
  - [x] 3.3 Test: local-only credential → appears in merged, summary.kept
  - [x] 3.4 Test: both exist, remote `updatedAt` newer → remote wins, summary.updated
  - [x] 3.5 Test: both exist, local `updatedAt` newer → local wins, summary.kept
  - [x] 3.6 Test: both exist, same `updatedAt` → local wins (tie-break = local), summary.kept
  - [x] 3.7 Test: deletion conflict — local deleted, remote modified later → remote wins (not deleted)
  - [x] 3.8 Test: deletion conflict — remote deleted, local modified later → local wins (not deleted)
  - [x] 3.9 Test: both deleted → merged is deleted, summary.deleted
  - [x] 3.10 Test: simultaneous new credentials (different UUIDs, same service+username) → both kept
  - [x] 3.11 Test: empty local vault + populated remote → all remote credentials added
  - [x] 3.12 Test: populated local vault + empty remote → all local credentials kept
  - [x] 3.13 Test: both empty → merged is empty, all summary arrays empty

- [x] **Task 4: Unit tests for settings and encryption keys merge** (AC: 7, 8, 11)
  - [x] 4.1 Test: settings — local `{a: '1'}`, remote `{b: '2'}` → merged `{a: '1', b: '2'}`
  - [x] 4.2 Test: settings — same key, different values → remote wins
  - [x] 4.3 Test: settings — `midnightSecretKey` preserved (critical: this key must never be lost)
  - [x] 4.4 Test: encryption keys — local `[ek1]`, remote `[ek2]` → merged `[ek1, ek2]`
  - [x] 4.5 Test: encryption keys — duplicate id → deduplicated (one entry per id)
  - [x] 4.6 Test: encryption keys — empty on one side → other side's keys kept

- [x] **Task 5: Unit tests for merged vault envelope** (AC: 9)
  - [x] 5.1 Test: merged version = `Math.max(local.version, remote.version)`
  - [x] 5.2 Test: merged `lastModified` is recent Unix timestamp (>= test start time)
  - [x] 5.3 Test: merged vault is valid — can be serialized to JSON and parsed by `VaultStore.fromJson()`

- [x] **Task 6: TypeScript verification** (AC: 1-11)
  - [x] 6.1 Run `tsc --noEmit` in `shared/vault-types/` — zero errors
  - [x] 6.2 Run `pnpm test` in `shared/vault-types/` — all tests pass (existing 57 + new merge tests)

## Dev Notes

### What This Story Is

A **pure function library story** — no UI, no browser extension, no blockchain interaction. All work is in `shared/vault-types/`. The function `resolveVaultConflict` takes two `VaultJson` objects and returns a merged vault. Story 4.3 will wire this into `VaultSyncService`.

### Architecture Spec (Section 3, lines 372-423)

The architecture defines `resolveVaultConflict` pseudocode verbatim. The implementation in this story follows it closely with one clarification on deletion conflicts (see below).

```typescript
// Architecture pseudocode (Section 3):
function resolveVaultConflict(
  local: VaultJson,
  remote: VaultJson
): { merged: VaultJson; summary: MergeSummary } {
  const merged: Record<string, CredentialTree> = {}
  const summary: MergeSummary = { added: [], updated: [], deleted: [], kept: [] }

  const allIds = new Set([...Object.keys(local.credentials), ...Object.keys(remote.credentials)])

  for (const id of allIds) {
    const localCred = local.credentials[id]
    const remoteCred = remote.credentials[id]

    if (!localCred) {
      merged[id] = remoteCred; summary.added.push(id)
    } else if (!remoteCred) {
      merged[id] = localCred; summary.kept.push(id)
    } else {
      // Last-write-wins
      if (remoteCred.updatedAt > localCred.updatedAt) {
        merged[id] = remoteCred; summary.updated.push(id)
      } else {
        merged[id] = localCred; summary.kept.push(id)
      }
    }
  }

  // Settings: remote wins on conflict
  const mergedSettings = { ...local.settings, ...remote.settings }

  // Encryption keys: union by id
  const keyMap = new Map(local.encryptionKeys.map(k => [k.id, k]))
  for (const rk of remote.encryptionKeys) keyMap.set(rk.id, rk)

  return {
    merged: {
      version: Math.max(local.version, remote.version),
      credentials: merged,
      settings: mergedSettings,
      encryptionKeys: [...keyMap.values()],
      lastModified: Date.now(),
    },
    summary,
  }
}
```

### Deletion Conflict Clarification

The architecture's `updatedAt` comparison naturally handles deletion conflicts:
- `deleteCredentialById` bumps `updatedAt` AND sets `isDeleted = true` (verified in Story 4.1 tests)
- So if Device A deletes at T=100 and Device B edits at T=200, the merge picks Device B's version (T=200 > T=100), which is NOT deleted
- If Device A deletes at T=200 and Device B's last edit was T=100, the merge picks Device A's version (deleted, T=200)
- AC 5 says "deleted but remote modified later → remote wins" — this falls out naturally from `updatedAt` comparison

The `summary.deleted` array tracks credentials where the winning version has `isDeleted = true`. After the merge loop, scan merged credentials and populate `summary.deleted` with IDs where `isDeleted === true` AND the credential exists in BOTH vaults (newly soft-deleted credentials that were only on one side go to `added`/`kept` with their `isDeleted` state preserved).

### Type Definitions (Already Exist)

All types needed are in `shared/vault-types/src/types.ts`:
- `VaultJson` — top-level vault with `credentials: Record<string, CredentialTree>`
- `CredentialTree` — has `updatedAt: number`, `isDeleted: boolean`
- `EncryptionKeyEntry` — has `id: string`

New types to add: `MergeSummary`, `MergeResult`.

### File Placement

The merge function is a pure utility — no VaultStore instance needed. Place in its own file for clean separation:
- `shared/vault-types/src/mergeVault.ts` — the function
- `shared/vault-types/src/__tests__/mergeVault.test.ts` — the tests

Export from `shared/vault-types/src/index.ts` so Story 4.3 can import from `@aliasvault/vault-types`.

### Test Helper Pattern

Build test helpers to construct `VaultJson` objects with minimal boilerplate:

```typescript
function makeVault(overrides: Partial<VaultJson> = {}): VaultJson {
  return {
    version: 1,
    credentials: {},
    settings: {},
    encryptionKeys: [],
    lastModified: Date.now(),
    ...overrides,
  };
}

function makeTree(id: string, updatedAt: number, overrides: Partial<CredentialTree> = {}): CredentialTree {
  return {
    id,
    serviceName: 'Test Service',
    username: 'testuser',
    password: { value: 'pass', createdAt: updatedAt, updatedAt },
    notes: '',
    alias: { birthDate: '1990-01-01' },
    attachments: [],
    totpCodes: [],
    passkeys: [],
    createdAt: updatedAt,
    updatedAt,
    isDeleted: false,
    ...overrides,
  };
}
```

### What NOT To Do

- **DO NOT** modify `VaultStore` class — the merge function operates on raw `VaultJson`, not VaultStore instances
- **DO NOT** add merge logic to `VaultSyncService` — that's Story 4.3
- **DO NOT** touch the browser extension — this is a shared library story
- **DO NOT** import anything outside `shared/vault-types/` — pure function, zero dependencies
- **DO NOT** handle encryption/decryption — callers pass already-decrypted `VaultJson` objects
- **DO NOT** add conflict detection — that's Story 4.3 (`saveWithConflictCheck`)

### Edge Case: Tie-Break When updatedAt Is Equal

When both local and remote have identical `updatedAt`, local wins. This is safe because:
- Device clocks may differ slightly but `Date.now()` precision is ms
- Exact ties are extremely unlikely in practice
- Choosing a deterministic winner (always local) prevents ping-pong on repeated merges

### Project Structure Notes

- All changes in `shared/vault-types/` — existing package, already in `pnpm-workspace.yaml`
- No new packages or dependencies
- No workspace topology changes (Rule 24 not affected)
- The `shared/vault-types/src/index.ts` barrel export must be updated

### References

- [Source: _bmad-output/architecture.md#Section-3] — `resolveVaultConflict()` pseudocode, MergeSummary type, CredentialTree types
- [Source: _bmad-output/architecture.md#Pattern-5] — Conflict resolution flow trigger points, merge notification pattern
- [Source: _bmad-output/project-planning-artifacts/epics.md#Story-4.2] — Epic AC and source hints
- [Source: _bmad-output/implementation-artifacts/sprint-change-proposal-2026-03-02.md#Section-4] — Story 4.2 revision: direct VaultJson operation
- [Source: shared/vault-types/src/types.ts] — VaultJson, CredentialTree, EncryptionKeyEntry types
- [Source: shared/vault-types/src/VaultStore.ts:68] — `toJson()` stamps `lastModified = Date.now()`
- [Source: shared/vault-types/src/__tests__/VaultStore.test.ts:712-728] — `deleteCredentialById` bumps `updatedAt` + sets `isDeleted`
- [Source: _bmad-output/implementation-artifacts/4-1-credential-add-edit-flow.md] — Previous story context: timestamp verification complete
- [Source: _bmad-output/implementation-artifacts/4-0-vault-format-migration.md] — VaultStore foundation, 57 existing tests
- [Source: _bmad-output/project-context.md#Rule-23] — JSON vault format enforcement

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (claude-opus-4-6)

### Debug Log References

None — clean implementation with no blockers.

### Completion Notes List

- Task 1: Added `MergeSummary` and `MergeResult` types to `types.ts`. Already exported via wildcard `export *` in `index.ts`.
- Task 2: Implemented `resolveVaultConflict()` in `mergeVault.ts` following architecture pseudocode exactly. Added post-merge deletion classification: when the winning version (both sides present) has `isDeleted=true`, the credential moves to `summary.deleted` instead of `updated`/`kept`.
- Task 3: 12 credential merge tests covering all AC scenarios (remote-only, local-only, last-write-wins, deletion conflicts, simultaneous creates, empty vaults).
- Task 4: 6 tests for settings merge (union, remote-wins, midnightSecretKey preservation) and encryption keys merge (union by id, deduplication, empty-side handling).
- Task 5: 4 tests for vault envelope (version max, lastModified freshness, version when local higher, JSON serialization round-trip).
- Task 6: `tsc --noEmit` zero errors, 79/79 tests pass (57 existing + 22 new).

### Change Log

- 2026-03-04: Story 4.2 implementation complete — `resolveVaultConflict()` pure merge function with 22 unit tests covering all 11 acceptance criteria.

### File List

- `shared/vault-types/src/types.ts` — added `MergeSummary`, `MergeResult` types
- `shared/vault-types/src/mergeVault.ts` — new file: `resolveVaultConflict()` implementation
- `shared/vault-types/src/index.ts` — added `resolveVaultConflict` export
- `shared/vault-types/src/__tests__/mergeVault.test.ts` — new file: 22 unit tests
