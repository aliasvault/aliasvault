# Offline Sync Implementation Specification

## Overview

This document defines the offline sync architecture for AliasVault clients. All clients (browser extension, mobile apps, web app) should follow these patterns to ensure consistent behavior and prevent data loss.

**Reference Implementation**: Browser extension (`apps/browser-extension`)

---

## Core Principles

1. **Local-first**: Always work with local vault, sync in background
2. **Never lose user data**: Local changes must survive network failures, app crashes, restarts
3. **LWW (Last-Write-Wins)**: Conflict resolution based on `UpdatedAt` timestamps
4. **Atomic metadata**: Vault blob and sync state stored together
5. **Server is source of truth for revision**: Server assigns revision numbers
6. **Race detection**: Mutation sequence counter prevents concurrent overwrites

---

## Storage Architecture

### Three Storage Layers

```
1. Persistent Storage (survives app restart):
   - Encrypted vault blob
   - Sync state (isDirty, mutationSequence, serverRevision)
   - Vault metadata (email domains)
   - Offline mode flag
   - Auth tokens & encryption params

2. Session Storage (cleared on app close):
   - Derived encryption key (SECURITY: never persist!)
   - Temporary form values

3. Memory (runtime only):
   - sqliteClient (in-memory database)
   - Cached vault blob (reduces decryption)
   - React/UI state mirrors
```

### Persistent Storage Keys

```
local:encryptedVault           - Full encrypted SQLite blob
local:serverRevision           - Last synced server revision number
local:isDirty                  - Boolean: true if local has unsynced changes
local:mutationSequence         - Counter: increments on each local mutation
local:isOfflineMode            - Boolean: true if currently offline
local:encryptionKeyDerivationParams - Salt/algorithm for key derivation
local:username                 - For display purposes
local:publicEmailDomains       - Email domain lists
local:privateEmailDomains
local:hiddenPrivateEmailDomains
```

### Session Storage Keys

```
session:encryptionKey          - Derived encryption key (SECURITY: never persist!)
```

---

## Critical: Atomic Vault Storage Pattern

**All vault storage operations MUST include sync flags atomically.**

This prevents a race condition where:
1. Vault saved locally
2. App crashes before `isDirty` is set
3. On restart, `isDirty=false` → sync overwrites local changes → **DATA LOSS**

### Two Storage Modes

The vault storage handler supports two distinct modes:

#### Mode 1: Local Mutation (markDirty=true)
```typescript
// After user creates/edits/deletes an item:
storeEncryptedVault({
  vaultBlob: encryptedVault,
  markDirty: true  // Always succeeds, increments mutationSequence
});

// Atomically stores:
// - local:encryptedVault = vaultBlob
// - local:isDirty = true
// - local:mutationSequence++ (incremented)
```

#### Mode 2: Sync Operation (expectedMutationSeq provided)
```typescript
// After downloading/merging from server:
storeEncryptedVault({
  vaultBlob: encryptedVault,
  serverRevision: newRevision,
  expectedMutationSeq: capturedSequence  // Race detection!
});

// Only succeeds if: currentMutationSeq === expectedMutationSeq
// Returns { success: false } if mismatch (concurrent mutation detected)
```

### Why Mutation Sequence?

The `mutationSequence` counter solves a critical race condition:

```
Problem:
  Time 1: Sync starts, captures mutationSequence=5
  Time 2: User edits item → mutationSequence=6
  Time 3: Sync tries to save server vault
          If we overwrite, user's edit is LOST!

Solution:
  Time 3: Sync tries to save with expectedMutationSeq=5
          But current is 6 → REJECTED
          Sync restarts with fresh data
```

### Sync State Truth Table

| Operation                    | isDirty | mutationSequence | serverRevision |
|------------------------------|---------|------------------|----------------|
| Fetch vault from server      | `false` | unchanged        | server's rev   |
| Local mutation (any mode)    | `true`  | incremented      | unchanged      |
| Successful upload to server  | `false`*| unchanged        | new server rev |
| Failed upload (network)      | `true`  | unchanged        | unchanged      |
| Race detected during sync    | `true`  | unchanged        | unchanged      |
| Vault cleared (logout)       | removed | removed          | removed        |

*Only cleared if no mutations occurred during upload (mutationSeq unchanged)

---

## Unlock Flow

**Key principle**: Always unlock from local vault first, then sync in background.

### Pseudocode

```
UNLOCK(password_or_pin):
  // 1. Derive encryption key
  if ONLINE:
    params = GET_ENCRYPTION_PARAMS_FROM_SERVER()
    STORE_ENCRYPTION_PARAMS(params)
  else:
    params = GET_STORED_ENCRYPTION_PARAMS()
    if params is null:
      ERROR("Cannot unlock offline without previous login")

  encryptionKey = DERIVE_KEY(password_or_pin, params)
  STORE_ENCRYPTION_KEY_IN_SESSION(encryptionKey)

  // 2. ALWAYS initialize from local vault first
  localVault = GET_ENCRYPTED_VAULT_FROM_LOCAL_STORAGE()
  decryptedVault = DECRYPT(localVault, encryptionKey)
  INITIALIZE_DATABASE(decryptedVault)

  // 3. Navigate to main app, sync in background
  NAVIGATE_TO_MAIN_VIEW()
  SYNC_VAULT_IN_BACKGROUND()  // Non-blocking!
```

**Why unlock from local first?**
- User gets immediate access to their data
- Local changes are never lost
- Sync happens after unlock (can fail safely)
- UI doesn't block on network

---

## Sync Flow

**Key principles**:
1. Check `isDirty` before overwriting local vault
2. **Upload pending changes** - sync is responsible for uploading, not just downloading
3. **Race detection** - use mutation sequence to detect concurrent edits
4. **Recursive retry** - if race detected, restart sync

### Pseudocode

```
SYNC_VAULT():
  if not ONLINE:
    SET_OFFLINE_MODE(true)
    return SUCCESS  // Continue with local vault

  SET_OFFLINE_MODE(false)

  // Capture state at start for race detection
  syncState = GET_SYNC_STATE()
  mutationSeqAtStart = syncState.mutationSequence

  serverRevision = GET_SERVER_REVISION()
  localRevision = syncState.serverRevision
  isDirty = syncState.isDirty

  if serverRevision > localRevision:
    // Server has newer vault - download it
    serverVault = FETCH_SERVER_VAULT()

    if isDirty:
      // CRITICAL: We have local changes - must merge!
      localVault = GET_LOCAL_ENCRYPTED_VAULT()
      mergedVault = LWW_MERGE(localVault, serverVault)

      // Store merged vault with race detection
      result = STORE_ENCRYPTED_VAULT({
        vaultBlob: mergedVault,
        expectedMutationSeq: mutationSeqAtStart
      })

      if not result.success:
        // Race detected - concurrent mutation happened
        return SYNC_VAULT()  // Recursive retry

      // Upload merged vault to server
      uploadResponse = UPLOAD_VAULT(mergedVault)
      if uploadResponse.success:
        MARK_VAULT_CLEAN(uploadResponse.newRevision, mutationSeqAtStart)

      INITIALIZE_DATABASE(mergedVault)
    else:
      // No local changes - safe to overwrite
      result = STORE_ENCRYPTED_VAULT({
        vaultBlob: serverVault,
        serverRevision: serverRevision,
        expectedMutationSeq: mutationSeqAtStart
      })

      if not result.success:
        return SYNC_VAULT()  // Race detected

      INITIALIZE_DATABASE(serverVault)

  else if serverRevision == localRevision:
    if isDirty:
      // Local changes at same revision - upload them!
      localVault = GET_LOCAL_ENCRYPTED_VAULT()
      uploadResponse = UPLOAD_VAULT(localVault, mutationSeqAtStart)

      if uploadResponse.success:
        MARK_VAULT_CLEAN(uploadResponse.newRevision, mutationSeqAtStart)
      else if uploadResponse.status == OUTDATED:
        // Another device uploaded - recurse to merge
        return SYNC_VAULT()
      // else: keep isDirty true, retry later
    else:
      // Already in sync - nothing to do
      pass

  return SUCCESS
```

### Mark Vault Clean Logic

```
MARK_VAULT_CLEAN(newServerRevision, mutationSeqAtStart):
  currentMutationSeq = GET_CURRENT_MUTATION_SEQUENCE()

  // Always update server revision
  SET_SERVER_REVISION(newServerRevision)

  // Only clear dirty flag if no mutations happened during sync
  if currentMutationSeq == mutationSeqAtStart:
    SET_IS_DIRTY(false)
  // else: keep dirty, another mutation needs syncing
```

### Critical: Sync Must Upload

A common mistake is to only handle downloads during sync. The sync flow **must also upload** pending local changes:

1. **After merge**: Upload merged vault to server immediately
2. **Same revision with pending**: Upload local vault to server
3. **Only clear `isDirty`** after successful upload AND no concurrent mutations

---

## Mutation Flow

**Key principle**: Save locally first, trigger sync in background. LWW merge handles conflicts.

### Two Mutation Patterns

#### Pattern 1: Blocking Mutation (with loading state)
```
MUTATE_VAULT_BLOCKING(operation):
  SET_IS_LOADING(true)

  // 1. Apply mutation to local database
  operation()  // e.g., create/update/delete item

  // 2. Export and encrypt
  vaultBlob = EXPORT_DATABASE_TO_BASE64()
  encryptedVault = ENCRYPT(vaultBlob, encryptionKey)

  // 3. Store locally with dirty flag (ATOMIC!)
  STORE_ENCRYPTED_VAULT({
    vaultBlob: encryptedVault,
    markDirty: true
  })

  // 4. Sync and wait for completion
  await SYNC_VAULT()

  SET_IS_LOADING(false)
```

#### Pattern 2: Non-Blocking Mutation (async sync)
```
MUTATE_VAULT_ASYNC(operation):
  // 1. Apply mutation to local database
  operation()

  // 2. Export and encrypt
  vaultBlob = EXPORT_DATABASE_TO_BASE64()
  encryptedVault = ENCRYPT(vaultBlob, encryptionKey)

  // 3. Store locally (ATOMIC!)
  STORE_ENCRYPTED_VAULT({
    vaultBlob: encryptedVault,
    markDirty: true
  })

  // 4. Trigger sync in background (fire-and-forget)
  TRIGGER_BACKGROUND_SYNC()
  // UI unblocks immediately, user can continue
```

### Background Sync Queue

```
TRIGGER_BACKGROUND_SYNC():
  if SYNC_IN_PROGRESS:
    return  // Let current sync pick up changes

  SET_SYNC_IN_PROGRESS(true)

  SYNC_VAULT()

  // After sync, check if more mutations happened
  if IS_DIRTY:
    TRIGGER_BACKGROUND_SYNC()  // Recursive: sync again

  SET_SYNC_IN_PROGRESS(false)
```

### Why No Pre-Sync?

Previous versions would sync before mutations to ensure working with the latest vault. This is unnecessary because:

1. **LWW merge resolves conflicts** - Even if mutating a stale vault, the merge will pick the record with the latest `UpdatedAt`
2. **Popup open triggers sync** - Vault is reasonably fresh when user starts interacting
3. **Simpler mental model** - Mutation = save + sync, that's it
4. **Fewer edge cases** - No pre-sync failure handling needed

---

## In-Memory Cache Strategy

To avoid repeated decryption, the implementation uses an in-memory cache:

```
CACHE:
  cachedSqliteClient: SqliteClient | null
  cachedVaultBlob: string | null

ON_LOCAL_MUTATION:
  // Don't clear cache - local mutations work directly on cached client
  cachedSqliteClient.execute(mutation)
  EXPORT_AND_STORE_ENCRYPTED()

ON_EXTERNAL_UPDATE (login, sync download, logout):
  // Clear cache - external data needs re-initialization
  cachedSqliteClient = null
  cachedVaultBlob = null
  INITIALIZE_FROM_STORAGE()
```

**Why this matters:**
- Local mutations are fast (no decryption)
- External updates ensure consistency (fresh decrypt)
- Reduces CPU usage significantly

---

## LWW Merge Algorithm

### Core Rule

For each record, compare `UpdatedAt` timestamps. The record with the **later** timestamp wins.

### Merge Pseudocode

```
LWW_MERGE(localVault, serverVault):
  mergedVault = CLONE(serverVault)  // Start with server as base

  for each TABLE in SYNCABLE_TABLES:
    localRecords = GET_RECORDS(localVault, TABLE)
    serverRecords = GET_RECORDS(serverVault, TABLE)

    // Build lookup for server records
    serverById = MAP(serverRecords, record => record.Id)

    for each localRecord in localRecords:
      serverRecord = serverById[localRecord.Id]

      if serverRecord is null:
        // Local-only record - keep it
        ADD_RECORD(mergedVault, TABLE, localRecord)

      else if localRecord.UpdatedAt > serverRecord.UpdatedAt:
        // Local is newer - use local
        UPDATE_RECORD(mergedVault, TABLE, localRecord)

      // else: server is newer or equal - already in merged (from clone)

  return mergedVault
```

### Syncable Tables

All entities extending `SyncableEntity`:
- `Item` - Main credential/login entity
- `FieldValue` - Field data per item
- `Folder` - Hierarchical folders
- `Tag` - User tags
- `ItemTag` - Item-tag relationships
- `Attachment` - File attachments
- `TotpCode` - TOTP secrets
- `Passkey` - WebAuthn credentials
- `FieldDefinition` - Custom field definitions
- `FieldHistory` - Field change history
- `Logo` - Deduplicated logos

### Special Cases

1. **Soft deletes are sticky**: `IsDeleted=true` should only be overwritten by a record with later `UpdatedAt` that explicitly sets `IsDeleted=false`

2. **DeletedAt handling**: For items moved to trash, `DeletedAt` timestamp determines trash state

3. **Child entities**: Merge independently - a newer parent doesn't automatically make children newer

---

## UI Indicators

### States to Display (Priority Order)

| Priority | State | Condition | UI |
|----------|-------|-----------|-----|
| 1 | **Offline** | `isOffline=true` | Amber badge: "Offline" |
| 2 | **Syncing** | `isSyncing=true` | Green badge with spinner: "Syncing vault..." |
| 3 | **Pending** | `isDirty=true` | Blue badge with spinner: "Pending sync" |
| 4 | **Synced** | all false | No indicator (hidden) |

### Important: Only show indicators when vault is unlocked

```typescript
// Don't show sync indicators when vault is locked
if (!isLoggedIn || !dbAvailable) {
  return null;  // No indicator
}
```

### State Transitions

```
User makes edit:
  Synced → Pending → (sync starts) → Syncing → Synced

Network goes down:
  Synced → Offline

Network restored + pending changes:
  Offline → Pending → Syncing → Synced
```

---

## Offline Mode Behaviors

### Entry Conditions

- Server returns connection error (detected as version `0.0.0`)
- User must have local vault (`dbAvailable=true`)
- Otherwise throws error (cannot use app without vault)

### Offline Capabilities

- Create/edit/delete credentials locally
- All mutations increment `mutationSequence` and set `isDirty=true`
- UI shows "Offline" badge
- Can lock/unlock vault using stored encryption params
- Form values persist encrypted in session storage

### Return to Online

```
Network restored:
1. Next syncVault() call succeeds
2. Server revision > local?
   └─ Merge local with server
3. Upload merged/local vault
4. setIsOffline(false)
5. UI shows normal state
```

---

## Vault Pruning (Trash Auto-Cleanup)

Items moved to trash (`DeletedAt` set) are automatically pruned after 30 days. This happens as part of the sync flow, before uploading the vault to the server.

### Pruning Flow

```
BEFORE_UPLOAD():
  1. Read Items, FieldValues, Attachments, TotpCodes, Passkeys tables
  2. Find items where:
     - DeletedAt is set (in trash)
     - DeletedAt < (now - 30 days)
     - IsDeleted = false (not already permanently deleted)
  3. For each expired item:
     - Set IsDeleted = true, UpdatedAt = now
     - Set IsDeleted = true for all related entities
  4. Execute SQL statements returned by Rust
  5. Continue with vault upload
```

### Implementation Details

- **Rust module**: `vault_pruner` in `core/rust/src/vault_pruner/mod.rs`
- **Browser extension**: Called in `VaultMessageHandler.ts` → `uploadNewVaultToServer()`
- **AliasVault.Client**: Called in `DbService.cs` → `PruneExpiredTrashItemsAsync()`
- **Retention period**: 30 days (configurable in Rust API)
- **Graceful failure**: If pruning fails, continues with upload (logs warning)

### Key Points

1. **Pruning is automatic**: Happens transparently during sync
2. **User can restore within 30 days**: Items in "Recently Deleted" can be restored
3. **Permanent after 30 days**: Items are marked with `IsDeleted = true` (tombstone)
4. **Cross-platform consistency**: Rust WASM handles logic for all clients

---

## Key Files (Browser Extension)

| File | Purpose |
|------|---------|
| `VaultMessageHandler.ts` | Background storage handlers with race detection, prune integration |
| `DbContext.tsx` | React context for vault state management |
| `useVaultSync.ts` | **Primary sync logic** - handles download, upload, merge, offline, race detection |
| `useVaultMutate.ts` | Mutation execution with blocking/async patterns |
| `VaultMergeService.ts` | LWW merge and prune implementation |
| `ServerSyncIndicator.tsx` | UI status indicator component |
| `Unlock.tsx` | Unlock flow (local-first) |
| `Reinitialize.tsx` | Post-unlock initialization and background sync trigger |
| `background.ts` | Message routing between popup and background |

---

## Testing Scenarios

### Basic Offline Flow
1. [ ] Go offline (disable network)
2. [ ] Make mutation (create/edit item)
3. [ ] Verify saved locally (indicator shows "Offline")
4. [ ] Lock vault
5. [ ] Go online
6. [ ] Unlock vault
7. [ ] Verify local changes preserved and synced

### Merge Conflict
1. [ ] Device A: Create item, sync
2. [ ] Device B: Sync to get item
3. [ ] Device A: Go offline, edit item
4. [ ] Device B: Edit same item, sync
5. [ ] Device A: Go online
6. [ ] Verify LWW merge (later edit wins)

### Crash Recovery
1. [ ] Make offline mutation
2. [ ] Force-kill app (simulate crash)
3. [ ] Reopen app
4. [ ] Verify `isDirty=true` preserved
5. [ ] Verify local changes still exist

### Unlock with Pending Changes
1. [ ] Go offline
2. [ ] Make mutation
3. [ ] Lock vault
4. [ ] Go online
5. [ ] Unlock vault
6. [ ] Verify merge happens before using server vault

### Race Condition (Concurrent Mutations)
1. [ ] Start sync operation (e.g., downloading large vault)
2. [ ] During sync, make local mutation
3. [ ] Verify sync detects race (mutationSeq changed)
4. [ ] Verify sync restarts and includes new mutation
5. [ ] Verify no data loss

---

## FieldValue Update Strategy (SqliteClient)

When updating an Item with FieldValues, the `updateItem()` method uses a **preserve-and-track** strategy to maintain stable FieldValue IDs for proper merge behavior.

### Why Stable IDs Matter

The merge service matches FieldValues by composite key (`ItemId + FieldKey`), but having stable IDs improves efficiency and reduces merge complexity. If we deleted all FieldValues and recreated them with new IDs on every save, the merge would work but create unnecessary churn.

### The Strategy

```
UPDATE_ITEM(item):
  1. QUERY existing FieldValues for this item
     existingFields = SELECT * FROM FieldValues WHERE ItemId = ? AND IsDeleted = 0

  2. BUILD lookup map by composite key
     existingByKey = MAP each field to "{FieldKey}:{index}"

  3. TRACK which existing IDs we process
     processedIds = SET()

  4. FOR EACH field in item.Fields:
     compositeKey = "{field.FieldKey}:{index}"
     existing = existingByKey[compositeKey]

     IF existing:
       // UPDATE in place - preserves the original FieldValue ID
       processedIds.add(existing.Id)
       IF value changed:
         UPDATE FieldValues SET Value = ?, UpdatedAt = ? WHERE Id = ?
     ELSE:
       // INSERT new FieldValue with random UUID
       INSERT INTO FieldValues (Id, ItemId, FieldKey, Value, ...)
       VALUES (randomUUID(), ...)

  5. SOFT-DELETE removed fields
     FOR EACH existing in existingFields:
       IF existing.Id NOT IN processedIds:
         // Field was removed - soft delete it
         UPDATE FieldValues SET IsDeleted = 1, UpdatedAt = ? WHERE Id = ?
```

### Benefits

1. **Stable IDs for unchanged fields**: Fields that aren't modified keep their original UUID
2. **Efficient updates**: Only changed fields get new `UpdatedAt` timestamps
3. **Clean removal**: Removed fields are properly soft-deleted
4. **Merge-friendly**: Composite key matching in merge handles cases where IDs differ

### Example Scenario

```
Initial state: Item has FieldValues:
  - {Id: "A", FieldKey: "login.username", Value: "user@example.com"}
  - {Id: "B", FieldKey: "login.password", Value: "secret123"}

User edits only the password:

After updateItem():
  - {Id: "A", FieldKey: "login.username", Value: "user@example.com"}  // UNCHANGED - same ID
  - {Id: "B", FieldKey: "login.password", Value: "newsecret456", UpdatedAt: NOW}  // UPDATED in place
```

### Key Files

- `SqliteClient.ts` → `updateItem()` - Implements the preserve-and-track strategy
- `VaultMergeService.ts` → `mergeTableByCompositeKey()` - Handles merge by composite key

---

## Security Considerations

1. **Encryption key NEVER persisted** - Only in session storage
2. **Vault blob is encrypted** - Safe to persist locally
3. **User must re-authenticate after app close** - Session key is lost
4. **No plaintext in local storage** - All vault data encrypted
5. **Derivation params safe to store** - Salt alone cannot derive key

---

## Common Pitfalls to Avoid

### 1. Overwriting local changes
**Wrong:**
```typescript
if (serverRevision > localRevision) {
  initializeDatabase(serverVault);  // Overwrites local changes!
}
```

**Correct:**
```typescript
if (serverRevision > localRevision) {
  if (isDirty) {
    mergedVault = merge(localVault, serverVault);
    initializeDatabase(mergedVault);
  } else {
    initializeDatabase(serverVault);
  }
}
```

### 2. Separate storage calls (non-atomic)
**Wrong:**
```typescript
await storage.setItem('local:encryptedVault', vault);
await storage.setItem('local:isDirty', true);  // Crash here = lost flag!
```

**Correct:**
```typescript
await storage.setItems([
  { key: 'local:encryptedVault', value: vault },
  { key: 'local:isDirty', value: true },
  { key: 'local:mutationSequence', value: sequence + 1 }
]);  // Atomic
```

### 3. Fetching server vault during unlock
**Wrong:**
```typescript
// Unlock.tsx
serverVault = await fetchFromServer();
initializeDatabase(serverVault);  // Skips local!
```

**Correct:**
```typescript
// Unlock.tsx - always local first
localVault = await getLocalVault();
initializeDatabaseFromLocal(localVault);
// Then trigger background sync
triggerBackgroundSync();
```

### 4. Ignoring race conditions
**Wrong:**
```typescript
// Sync downloads server vault
const serverVault = await downloadVault();
// User edits during download (undetected!)
await storeVault(serverVault);  // Overwrites user's edit!
```

**Correct:**
```typescript
const mutationSeqAtStart = await getMutationSequence();
const serverVault = await downloadVault();

const result = await storeVault({
  vault: serverVault,
  expectedMutationSeq: mutationSeqAtStart  // Race detection!
});

if (!result.success) {
  return syncVault();  // Retry - will merge user's edit
}
```

### 5. Clearing dirty flag prematurely
**Wrong:**
```typescript
await uploadVault(localVault);
await setIsDirty(false);  // What if user edited during upload?
```

**Correct:**
```typescript
const mutationSeqAtStart = getMutationSequence();
await uploadVault(localVault);

// Only clear if no mutations happened during upload
if (getCurrentMutationSequence() === mutationSeqAtStart) {
  await setIsDirty(false);
}
```

---

## Disaster Recovery & Data Loss Prevention

### Server RPO Recovery

AliasVault implements two disaster recovery mechanisms to prevent data loss:

1. **Vault Preservation on Forced Logout** - Prevents data loss when session is forcibly terminated
2. **Server Rollback Handling** - Enables recovery when server has lower revision than client

**For detailed implementation, see:** [SERVER_RPO_RECOVERY.md](./SERVER_RPO_RECOVERY.md)

### Quick Summary

#### Vault Preservation on Forced Logout

**Problem:** When forced logout occurs (401 Unauthorized), if local vault is deleted, unsynced changes are lost.

**Solution:**
- **User-initiated logout**: Check `isDirty`, show warning dialog if unsynced changes, clear all data
- **Forced logout**: Preserve vault data in place, only clear session data (tokens, encryption key)
- **On login**: Check for existing vault, try to decrypt with new key, compare revisions with server

Vault data is preserved in regular storage keys (no separate "orphaned" keys). On re-login, the sync flow handles recovery automatically.

#### Server Rollback Handling

**Problem:** When server rolls back to earlier revision (e.g., 95 < client 100), sync needs to recover server state.

**Solution:** Explicit handling in sync logic:

```typescript
if (serverRevision < clientRevision) {
  // Server data loss detected - upload client vault to recover
  uploadVault();
  // Server assigns newRevision = clientRevision + 1 (creates gap)
}
```

**Why gap is acceptable:**
- Provides audit trail of disaster recovery event
- Server history is admin-only
- Clients only care about latest revision

---

## Revision History

- **2025-12**: Initial implementation with atomic `hasPendingSync` flag
- **2025-12**: Centralized merge logic in `useVaultSync.ts`
- **2025-12**: Simplified unlock flow to always use local vault first
- **2025-12**: `OfflineIndicator` with proper locked state handling
- **2025-12**: Preserve-and-track strategy for FieldValue updates in `updateItem()`
- **2025-12**: Composite key matching for FieldValues merge in `VaultMergeService`
- **2025-12**: **Major update**: Renamed `hasPendingSync` to `isDirty` to match implementation
- **2025-12**: **`mutationSequence` counter** for race condition detection
- **2025-12**: In-memory cache strategy documentation
- **2025-12**: UI indicators section with priority order and `ServerSyncIndicator` component
- **2025-12**: Blocking vs non-blocking mutation patterns
- **2025-12**: Background sync queue logic
- **2025-12**: Expanded race condition documentation and pitfalls
- **2025-12**: Concurrent mutation test scenario
- **2025-12**: **`vault_pruner` module** for 30-day trash auto-cleanup
- **2025-12**: Renamed `merge` module to `vault_merge` for consistency
- **2025-12**: Removed old 7-day `VaultCleanupSoftDeletedRecords` in favor of 30-day prune
- **2025-12**: "Recently Deleted" page in AliasVault.Client with restore functionality
- **2026-01**: **Disaster recovery section** - Server RPO recovery and vault preservation on forced logout
