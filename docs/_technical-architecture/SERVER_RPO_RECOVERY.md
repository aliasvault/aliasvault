# Server RPO Recovery & Vault Preservation

## Overview

This document describes two mechanisms to handle edge cases in vault synchronization:

1. **Vault Preservation on Forced Logout** - Prevents data loss when session is forcibly terminated
2. **Server Rollback Handling** - Enables recovery when server has lower revision than client

Both mechanisms address disaster recovery scenarios where server data loss (RPO - Recovery Point Objective) could result in client data being lost.

---

## Vault Preservation on Forced Logout

### Problem

When forced logout occurs (401 Unauthorized due to token revocation), if the client deletes the local vault immediately, any unsynced changes would be permanently lost.

### Solution

Two distinct logout flows handle this:

#### Flow A: User-Initiated Logout (Explicit button press)

**Behavior:**
1. Check if vault has unsynced changes (`isDirty = true`)
2. If dirty, show warning dialog asking user to confirm data loss
3. If user confirms, proceed with full vault deletion
4. If user cancels, abort logout

**Why:** User has agency to prevent data loss by syncing first or canceling logout.

#### Flow B: Forced Logout (401, token revocation, password change)

**Behavior:**
1. **Always** preserve encrypted vault + metadata (regardless of `isDirty` state)
2. Clear active session (tokens, current vault references)
3. Prefill username on login page as subtle hint

**Why:**
- User had no control over logout (forced by server)
- Vault might be more advanced than server (server rollback scenario)
- No security risk (vault is encrypted)
- Enables silent recovery on next login

### Storage Design

Forced logout **preserves the existing vault data in place** while clearing only session data. This allows recovery on re-login through normal sync flow.

#### Browser Extension Storage

**Vault Keys (preserved on forced logout):**
```typescript
'local:encryptedVault'        // Encrypted vault blob - PRESERVED
'local:serverRevision'        // Server revision number - PRESERVED
'local:isDirty'               // Has unsynced changes - PRESERVED
'local:mutationSequence'      // Mutation counter - PRESERVED
'local:username'              // Username for login prefill - PRESERVED
'local:encryptionKeyDerivationParams' // Key derivation params - PRESERVED
```

**Session Keys (cleared on forced logout):**
```typescript
'local:accessToken'           // JWT access token - CLEARED
'local:refreshToken'          // JWT refresh token - CLEARED
'session:encryptionKey'       // In-memory encryption key - CLEARED
```

#### Mobile App Storage (iOS/Android)

The mobile apps use native storage through `VaultStore` (Swift/Kotlin) which maintains:

**Persisted Storage (preserved on forced logout via `clearSession()`):**
- Encrypted vault database file
- Server revision number
- Dirty flag and mutation sequence
- Username (for login prefill)
- Encryption key derivation params

**Session Data (cleared on forced logout via `clearSession()`):**
- In-memory decryption key (keychain/keystore)
- Auth tokens
- In-memory decrypted vault reference

The native `clearSession()` method clears session data while preserving the persisted vault, whereas `clearVault()` clears everything including the persisted database.

### Login Flow with Silent Recovery

#### Browser Extension

When user logs in after a forced logout:

1. **Check for existing vault** in storage (`persistAndLoadVault()` in [Login.tsx](../../apps/browser-extension/src/entrypoints/popup/pages/auth/Login.tsx))
   - Reads `local:encryptedVault` and `local:serverRevision`
   - If no existing vault → Normal fresh login flow

2. **Attempt to decrypt existing vault** with derived encryption key
   - Uses `EncryptionUtility.symmetricDecrypt()` to verify vault can be decrypted
   - If decryption fails → Password was changed → Use server vault instead
   - If decryption succeeds → Continue to revision comparison

3. **Compare local revision with server revision**
   - If `localRev >= serverRev` → Keep local vault (don't overwrite), load existing decrypted vault
   - If `localRev < serverRev` → Server is more advanced → Download and use server vault

4. **Continue with normal sync flow**
   - The sync logic in `useVaultSync.ts` handles server rollback detection automatically
   - If `serverRevision < clientRevision`, sync uploads to recover server state

#### Mobile App (iOS/Android)

When user logs in after a forced logout:

1. **Check for existing vault** via `NativeVaultManager.hasEncryptedDatabase()` ([login.tsx](../../apps/mobile-app/app/login.tsx))
   - If no existing vault → Normal fresh login flow

2. **Attempt to unlock existing vault** via `NativeVaultManager.unlockVault()`
   - Native code attempts to decrypt vault using the newly derived encryption key
   - If decryption fails → Password was changed → Call `NativeVaultManager.clearVault()` to clear local vault
   - If decryption succeeds → Vault is valid, proceed to sync

3. **Sync handles revision comparison**
   - `syncVault()` is called which internally compares revisions
   - Native `VaultSync` (Swift/Kotlin) handles all cases:
     - `serverRev > localRev` → Download server vault
     - `serverRev == localRev && isDirty` → Upload local changes
     - `serverRev < localRev` → Server rollback detected → Upload to recover server
     - `serverRev == localRev && !isDirty` → Already in sync

### Recovery Decision Matrix

| Scenario | Vault Decrypt | Revision Comparison | Action |
|----------|---------------|---------------------|--------|
| Password unchanged, server rolled back | ✅ Success | `localRev >= serverRev` | Keep local vault → Sync uploads → **Data recovered!** |
| Password unchanged, server advanced | ✅ Success | `localRev < serverRev` | Use server vault (server is authoritative) |
| Password changed | ❌ Fails | N/A | Clear local vault, use server vault |
| No existing vault | N/A | N/A | Normal fresh login flow |

### Implementation Summary

#### Browser Extension

**Key files:**
- [AuthContext.tsx](../../apps/browser-extension/src/entrypoints/popup/context/AuthContext.tsx) - `clearAuthUserInitiated()` vs `clearAuthForced()`
- [AppContext.tsx](../../apps/browser-extension/src/entrypoints/popup/context/AppContext.tsx) - `logout()` calls `clearAuthForced()` to preserve vault
- [Settings.tsx](../../apps/browser-extension/src/entrypoints/popup/pages/settings/Settings.tsx) - User-initiated logout with dirty vault warning
- [Login.tsx](../../apps/browser-extension/src/entrypoints/popup/pages/auth/Login.tsx) - `persistAndLoadVault()` handles existing vault recovery
- [useVaultSync.ts](../../apps/browser-extension/src/entrypoints/popup/hooks/useVaultSync.ts) - Server rollback detection (lines 288-329)

#### Mobile App (Native iOS)

**Key files:**
- [VaultStore+Cache.swift](../../apps/mobile-app/ios/VaultStoreKit/VaultStore+Cache.swift) - `clearSession()` preserves vault, `clearVault()` clears all
- [VaultManager.swift](../../apps/mobile-app/ios/NativeVaultManager/VaultManager.swift) - React Native bridge for `clearSession()`
- [VaultStore+Sync.swift](../../apps/mobile-app/ios/VaultStoreKit/VaultStore+Sync.swift) - Server rollback detection (lines 229-241)

#### Mobile App (Native Android)

**Key files:**
- [VaultCache.kt](../../apps/mobile-app/android/app/src/main/java/net/aliasvault/app/vaultstore/VaultCache.kt) - `clearSession()` preserves vault
- [VaultStore.kt](../../apps/mobile-app/android/app/src/main/java/net/aliasvault/app/vaultstore/VaultStore.kt) - Exposes `clearSession()`
- [NativeVaultManager.kt](../../apps/mobile-app/android/app/src/main/java/net/aliasvault/app/nativevaultmanager/NativeVaultManager.kt) - React Native bridge
- [VaultSync.kt](../../apps/mobile-app/android/app/src/main/java/net/aliasvault/app/vaultstore/VaultSync.kt) - Server rollback detection (lines 117-131)

#### Mobile App (React Native)

**Key files:**
- [NativeVaultManager.ts](../../apps/mobile-app/specs/NativeVaultManager.ts) - `clearSession()` spec interface
- [AuthContext.tsx](../../apps/mobile-app/context/AuthContext.tsx) - `clearAuthUserInitiated()` vs `clearAuthForced()`
- [AppContext.tsx](../../apps/mobile-app/context/AppContext.tsx) - `logout()` calls `clearAuthForced()`
- [settings/index.tsx](../../apps/mobile-app/app/(tabs)/settings/index.tsx) - User-initiated logout with dirty vault warning
- [login.tsx](../../apps/mobile-app/app/login.tsx) - Existing vault recovery check (lines 196-210)

---

## Server Rollback Handling

### Problem

When server experiences data loss and recovers to an earlier revision (e.g., server at rev 95, client at rev 100), the sync logic needs to handle the `serverRevision < clientRevision` case to recover server state.

### Solution

Explicit handling for `serverRevision < clientRevision` case:

**Behavior:**
1. Detect server revision rollback (server is behind client)
2. Force upload client vault to recover server state
3. Server assigns new revision number (client's rev + 1, creating gap)
4. Client updates local `serverRevision` to new value
5. Log recovery event for audit trail

**Why this works:**
- Server already accepts advanced client revisions
- Server calculates `newRevisionNumber = clientRevision + 1`
- Creates revision gap (e.g., 95 → 101) which serves as audit trail
- Gap is visible to admins, indicates disaster recovery event

### Server Revision Assignment Logic

Looking at `apps/server/AliasVault.Api/Controllers/VaultController.cs:162-170`:

```csharp
// Server calculates new revision number
var newRevisionNumber = model.CurrentRevisionNumber + 1;

// Checks if server is already ahead
if (latestVault.RevisionNumber >= newRevisionNumber)
{
    return Ok(new VaultUpdateResponse {
        Status = VaultStatus.Outdated,
        NewRevisionNumber = latestVault.RevisionNumber
    });
}

// Otherwise accepts and saves with calculated revision
```

**Example:**
- Client sends `currentRevisionNumber = 100`
- Server calculates `newRevisionNumber = 100 + 1 = 101`
- Server checks: `latestVault.RevisionNumber (95) >= 101`? **NO**
- Server accepts and saves as **revision 101** ✅
- Creates gap: 95 → 101 (revisions 96-100 missing from server history)

**Why gap is acceptable:**
- Provides audit trail of disaster recovery event
- Server history is admin-only, not shared with clients
- Clients only care about latest revision
- Gap timestamp shows when recovery occurred

### Implementation

All platforms detect server rollback (`serverRevision < clientRevision`) and automatically upload to recover server state:

- **Browser Extension**: [useVaultSync.ts](../../apps/browser-extension/src/entrypoints/popup/hooks/useVaultSync.ts) (lines 288-329)
- **Android**: [VaultSync.kt](../../apps/mobile-app/android/app/src/main/java/net/aliasvault/app/vaultstore/VaultSync.kt) (lines 117-131)
- **iOS**: [VaultStore+Sync.swift](../../apps/mobile-app/ios/VaultStoreKit/VaultStore+Sync.swift) (lines 229-241)

---

## Testing Checklist

### Vault Preservation on Forced Logout

**Test Cases:**

- [ ] **User logout (clean vault)**
  - Vault has no unsynced changes
  - Click logout button in Settings
  - Expected: Normal confirmation dialog, vault cleared after logout

- [ ] **User logout (dirty vault, cancel)**
  - Make local change (vault becomes dirty - indicator shows)
  - Click logout button in Settings
  - Expected: Warning dialog appears about unsynced changes
  - Click "Cancel"
  - Expected: Logout aborted, still logged in, vault preserved

- [ ] **User logout (dirty vault, confirm)**
  - Make local change (vault becomes dirty)
  - Click logout button in Settings
  - Expected: Warning dialog appears
  - Click "Log out anyway"
  - Expected: Vault cleared, logged out

- [ ] **Forced logout (password unchanged)**
  - Simulate 401 response (e.g., revoke tokens on server)
  - Expected: Vault data preserved on device
  - Login with same username and password
  - Expected: Existing vault loaded, sync resumes normally

- [ ] **Forced logout (password changed)**
  - Change password on another device
  - First device receives 401
  - Expected: Vault data preserved (encrypted)
  - Login with new password
  - Expected: Old vault can't decrypt → Use server vault instead

- [ ] **Forced logout + server rollback**
  - Client at rev 100, server recovers to rev 95
  - Forced logout due to token expiry
  - Expected: Vault preserved with rev 100
  - Login
  - Expected: Local vault (rev 100) detected as more advanced, sync uploads → server recovers to rev 101

### Server Rollback Handling

**Test Cases:**

- [ ] **Server rollback (client clean, rev > server)**
  - Client at rev 100, isDirty=false
  - Server recovers to rev 95
  - Sync
  - Expected: Client uploads vault, server saves as rev 101

- [ ] **Server rollback (client dirty, rev > server)**
  - Client at rev 100, isDirty=true
  - Server recovers to rev 95
  - Sync
  - Expected: Client uploads vault, server saves as rev 101

- [ ] **Concurrent rollback recovery**
  - Client A at rev 100, Client B at rev 100
  - Server recovers to rev 95
  - Client A syncs first → Server saves as rev 101
  - Client B syncs → Server returns Outdated
  - Expected: Client B re-syncs and downloads rev 101

- [ ] **Normal sync after rollback recovery**
  - Server recovered to rev 101 via client upload
  - Make local change → Client at rev 101, isDirty=true
  - Sync
  - Expected: Normal upload, server saves as rev 102

---

## Design Decisions

### Vault Preservation Strategy

- Forced logout only clears session data (tokens, in-memory key)
- Vault data remains in regular storage keys
- On re-login, existing vault is detected and recovered through normal sync flow

This approach:
- Reduces storage complexity (no separate "orphaned" keys)
- Leverages existing sync logic for recovery
- Maintains single source of truth for vault data

### Recovery is Transparent

- No UI feedback when vault recovery happens on login
- Recovery happens silently through normal sync process
- Less confusing for users than explicit "recovery" messages

---

## Related Documentation

- [DATAMODEL_REFACTOR.md](./DATAMODEL_REFACTOR.md) - Vault storage architecture
- [OFFLINE_MODE.md](./OFFLINE_MODE.md) - Offline sync behavior
- Vault sync implementation files:
  - Browser: `apps/browser-extension/src/entrypoints/popup/hooks/useVaultSync.ts`
  - Android: `apps/mobile-app/android/app/src/main/java/net/aliasvault/app/vaultstore/VaultSync.kt`
  - iOS: `apps/mobile-app/ios/VaultStoreKit/VaultStore+Sync.swift`
