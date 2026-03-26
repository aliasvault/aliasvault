# Story 6.4d: New User Onboarding — Master Password Creation

Status: ready-for-dev

<!-- Enables first-time user flow on preprod. Without this, only returning users can access the extension. -->

## Story

As a **first-time user connecting my Lace wallet**,
I want **to create a master password and initialize an empty vault**,
so that **I can start saving credentials to the blockchain**.

## Acceptance Criteria

1. After wallet verification on Login page, new users (no vault on-chain) are navigated to a `/create-password` page
2. Returning users (vault exists on-chain) are navigated to `/unlock` as before
3. Master password creation page requires: password input, confirmation input, minimum 8 characters
4. On submit: generate salt, derive encryption key via Argon2Id, create empty VaultStore, generate Midnight secretKey, store all in session, initialize DbContext
5. After password creation, user lands on credentials page with an empty vault ready to use
6. Auth state is properly set so the user is considered "logged in" after wallet verification (placeholder tokens or wallet-based auth flag)
7. First vault save to blockchain works: add credential → save → IPFS upload → VaultRegistry CID hash updated
8. All existing tests pass, extension builds for preprod

## Tasks / Subtasks

- [ ] Task 1: Fix auth state after wallet verification (AC: #6)
  - [ ] 1.1 **Problem:** `AuthContext.initializeAuth()` checks for `local:accessToken` + `local:refreshToken` — wallet verification doesn't set these, so `isLoggedIn` stays `false`, and Reinitialize routes back to `/unlock` in a loop
  - [ ] 1.2 After `wallet.isVerified` becomes `true`, call `app.setAuthTokens(walletAddress, placeholderToken, placeholderToken)` to mark the user as logged in
  - [ ] 1.3 Use `wallet:${walletAddress}` as placeholder token value — this is never sent to a server, only used as a local "logged in" flag
  - [ ] 1.4 Alternative: refactor `AuthContext` to check `WalletContext.isVerified` as an auth source alongside tokens — cleaner but bigger change. Choose whichever approach is simpler.

- [ ] Task 2: Add new-vs-returning user detection after wallet verification (AC: #1, #2)
  - [ ] 2.1 In `Login.tsx`, after wallet verification (the green "Verified" badge), add a "Continue" button or auto-navigate
  - [ ] 2.2 On continue: call `sendMessage('LOAD_VAULT_FROM_BLOCKCHAIN', {}, 'background')` to check if a vault exists on-chain
  - [ ] 2.3 If `loadResponse.notRegistered === true` → navigate to `/create-password` (new user)
  - [ ] 2.4 If `loadResponse.encryptedBlob` exists → store blob in session, navigate to `/unlock` (returning user)
  - [ ] 2.5 If `loadResponse.upToDate === true` → navigate to `/unlock` (returning user, vault already cached)
  - [ ] 2.6 Handle errors gracefully (network failure, contract not found)

- [ ] Task 3: Create `/create-password` route and page (AC: #3)
  - [ ] 3.1 Create `apps/browser-extension/src/entrypoints/popup/pages/auth/CreatePassword.tsx`
  - [ ] 3.2 Add route in `App.tsx`: `{ path: '/create-password', element: <CreatePassword />, showBackButton: false, layout: LayoutType.AUTH }`
  - [ ] 3.3 Add `/create-password` to `NavigationContext.tsx` blocked pages list (auth flow page, should not be stored as "last page")
  - [ ] 3.4 UI: "Create Master Password" heading, password input with show/hide toggle, confirm password input, validation messages, "Create Vault" button
  - [ ] 3.5 Validation: passwords match, minimum 8 characters, button disabled until valid

- [ ] Task 4: Implement vault initialization on password creation (AC: #4)
  - [ ] 4.1 **Generate salt:** `crypto.getRandomValues(new Uint8Array(32))` → hex string (64 chars)
  - [ ] 4.2 **Build derivation params:**
    ```
    { encryptionType: 'Argon2Id',
      encryptionSettings: '{"Iterations":2,"MemorySize":19456,"DegreeOfParallelism":1}',
      salt: hexSalt }
    ```
  - [ ] 4.3 **Derive encryption key:** `EncryptionUtility.deriveKeyFromPassword(password, salt, 'Argon2Id', settings)` → Uint8Array(32) → base64
  - [ ] 4.4 **Generate Midnight secretKey:** `crypto.getRandomValues(new Uint8Array(32))` → hex string (64 chars). This is the VaultRegistry owner auth key (ADR-006).
  - [ ] 4.5 **Create empty vault:** Instantiate `VaultStore` (or equivalent empty vault JSON), store the secretKey inside vault settings: `vaultStore.setSetting('midnightSecretKey', secretKeyHex)`. Check how `VaultStore` is constructed — read `shared/vault-types/` to understand the constructor and `toJson()` method.
  - [ ] 4.6 **Encrypt vault:** `EncryptionUtility.symmetricEncrypt(vaultJson, keyBase64)`
  - [ ] 4.7 **Store in session via background messages (exact order):**
    1. `sendMessage('STORE_ENCRYPTION_KEY_DERIVATION_PARAMS', params, 'background')`
    2. `sendMessage('STORE_ENCRYPTION_KEY', keyBase64, 'background')`
    3. `sendMessage('STORE_VAULT', { vaultBlob, publicEmailDomainList: [], privateEmailDomainList: [], hiddenPrivateEmailDomainList: [], vaultRevisionNumber: 0 }, 'background')`
  - [ ] 4.8 **Cache secretKey locally:** `VaultCidStore.setSecretKey(secretKeyHex)` — for performance, avoids decrypting vault on every contract operation
  - [ ] 4.9 **Initialize DbContext:** Call `dbContext.initializeDatabaseFromBlob(encryptedVault, keyBase64)` — this sets `dbAvailable = true`

- [ ] Task 5: Navigate to credentials page after creation (AC: #5)
  - [ ] 5.1 After Task 4 completes, navigate to `/reinitialize` with `{ replace: true }`
  - [ ] 5.2 Reinitialize will see: `isFullyInitialized = true`, `requiresAuth = false` (because `isLoggedIn = true` from Task 1 AND `dbAvailable = true` from Task 4.9)
  - [ ] 5.3 Reinitialize calls `syncVault()` → `LOAD_VAULT_FROM_BLOCKCHAIN` → `notRegistered: true` (first time) → continues to credentials
  - [ ] 5.4 User sees empty credentials page, ready to add first credential

- [ ] Task 6: Verify first vault save works end-to-end (AC: #7)
  - [ ] 6.1 After vault initialization, user adds a credential (CredentialAddEdit.tsx)
  - [ ] 6.2 User clicks "Save to Blockchain" → `handleUploadVaultToBlockchain()` runs
  - [ ] 6.3 Upload flow: encrypt vault → upload to IPFS → join VaultRegistry with secretKey → call `updateVault(cidHash)` on contract
  - [ ] 6.4 Verify: VaultCidStore has secretKey, MidnightContractService can join contract, IPFS upload succeeds, CID hash written on-chain
  - [ ] 6.5 If first save requires a Lace wallet approval popup (ZK proof), verify that works on preprod

- [ ] Task 7: Run tests and build (AC: #8)
  - [ ] 7.1 Run `pnpm run test` in `apps/browser-extension/` — all tests pass
  - [ ] 7.2 Build with `VITE_MIDNIGHT_NETWORK=preprod` — no errors
  - [ ] 7.3 Manual test: fresh wallet → connect → verify → create password → see empty vault → add credential → save to blockchain

## Dev Notes

### Why This Is Needed

After Story 1.6 removed SRP auth, the extension's Login page was updated to use wallet verification. But the **post-verification flow was never built**:
- Login shows "Verified" badge with no next action
- `AuthContext` requires tokens that wallet auth never generates → user stays "not logged in"
- `Reinitialize` routes non-logged-in users to `/unlock` → nothing to unlock → stuck
- No master password creation page exists
- No empty vault initialization flow exists

### Auth State Machine (Current vs Fixed)

**Current (broken):**
```
Wallet verified → isLoggedIn=false (no tokens) → Reinitialize → /unlock → error (no vault)
```

**Fixed:**
```
Wallet verified → setAuthTokens(wallet placeholder) → isLoggedIn=true
  → LOAD_VAULT_FROM_BLOCKCHAIN
    → notRegistered? → /create-password → initialize vault → /reinitialize → /credentials
    → has vault?    → /unlock → enter password → decrypt → /reinitialize → /credentials
```

### Encryption Parameters (Exact Format)

```typescript
// EncryptionKeyDerivationParams type:
{
  encryptionType: 'Argon2Id',
  encryptionSettings: '{"Iterations":2,"MemorySize":19456,"DegreeOfParallelism":1}',
  salt: string  // 64-char hex (32 bytes)
}
```

Key derivation: `EncryptionUtility.deriveKeyFromPassword(password, salt, type, settings)` → `Uint8Array(32)` → convert to base64 for storage.

### Midnight SecretKey (ADR-006)

The secretKey proves vault ownership for contract writes. It's:
1. Generated once (32 random bytes → hex)
2. Stored inside the encrypted vault JSON (`vaultStore.setSetting('midnightSecretKey', hex)`) — travels with vault across devices via IPFS
3. Cached locally (`VaultCidStore.setSecretKey(hex)`) — performance optimization, avoids decrypting vault for every contract call
4. Used by `MidnightContractService.joinVaultRegistry(secretKey)` → passed to `createVaultRegistryPrivateState(secretKey)`

### Returning User Pattern (Reference — Unlock.tsx)

The existing password unlock for returning users follows this sequence:
```typescript
// 1. Get stored params
const params = await sendMessage('GET_ENCRYPTION_KEY_DERIVATION_PARAMS', {}, 'background');
// 2. Derive key
const hash = await EncryptionUtility.deriveKeyFromPassword(password, params.salt, params.encryptionType, params.encryptionSettings);
const hashBase64 = Buffer.from(hash).toString('base64');
// 3. Store key + initialize vault
await dbContext.storeEncryptionKey(hashBase64);
const vaultResponse = await webApi.get('Vault'); // ← server call (Story 6.4a replaces this)
await dbContext.initializeDatabase(vaultResponse, hashBase64);
// 4. Navigate
navigate('/reinitialize', { replace: true });
```

The new user flow mirrors steps 2-4 but GENERATES params (step 1) and CREATES an empty vault (step 3) instead of downloading one.

### VaultStore Construction

Before implementing, read how `VaultStore` is created in:
- `shared/vault-types/src/` — find the constructor, `toJson()`, `setSetting()` methods
- `apps/browser-extension/src/utils/dist/shared/vault-types/` — the bundled types available in the extension
- The dev agent should trace the exact API for creating an empty vault with settings

### Key Files to Read (Do NOT Modify Unless Needed)

| File | Why Read It |
|------|------------|
| `shared/vault-types/src/` | VaultStore constructor, toJson(), setSetting() |
| `apps/browser-extension/src/utils/EncryptionUtility.ts` | deriveKeyFromPassword, symmetricEncrypt |
| `apps/browser-extension/src/services/VaultCidStore.ts` | setSecretKey, getSecretKey |
| `apps/browser-extension/src/entrypoints/popup/context/DbContext.tsx` | initializeDatabaseFromBlob, storeEncryptionKey |
| `apps/browser-extension/src/entrypoints/popup/context/AuthContext.tsx` | setAuthTokens, initializeAuth |
| `apps/browser-extension/src/entrypoints/popup/pages/auth/Unlock.tsx` | Returning user pattern reference |
| `apps/browser-extension/src/entrypoints/popup/pages/Reinitialize.tsx` | Post-creation navigation hub |

### Key Files to Modify

| File | Change |
|------|--------|
| NEW: `apps/browser-extension/src/entrypoints/popup/pages/auth/CreatePassword.tsx` | Master password creation page |
| `apps/browser-extension/src/entrypoints/popup/App.tsx` | Add `/create-password` route |
| `apps/browser-extension/src/entrypoints/popup/pages/auth/Login.tsx` | Add post-verification navigation (new vs returning user detection) |
| `apps/browser-extension/src/entrypoints/popup/context/NavigationContext.tsx` | Add `/create-password` to blocked pages |
| `apps/browser-extension/src/entrypoints/popup/context/AuthContext.tsx` OR `Login.tsx` | Set auth state after wallet verification |

### What NOT To Do

- Do NOT modify EncryptionUtility — use it as-is
- Do NOT modify VaultCidStore — use existing `setSecretKey()` / `getSecretKey()`
- Do NOT modify the VaultRegistry contract — the contract already handles first-time users
- Do NOT auto-upload the vault during password creation — let the user add credentials first, then explicitly save. The first `handleUploadVaultToBlockchain()` call will handle the initial on-chain registration.
- Do NOT change the Argon2Id parameters — use the same defaults as Unlock.tsx

### References

- [Source: Architect audit — B2: No master password creation UI for new users]
- [Source: AuthContext.tsx — token-based auth requires setAuthTokens() call]
- [Source: Reinitialize.tsx — routes non-logged-in users to /unlock]
- [Source: EncryptionUtility.ts — deriveKeyFromPassword with Argon2Id]
- [Source: VaultCidStore.ts — secretKey persistence (ADR-006)]
- [Source: Unlock.tsx — returning user password flow (reference pattern)]
- [Source: VaultMessageHandler.ts:599-661 — handleUploadVaultToBlockchain]

## Dev Agent Record

### Agent Model Used
### Debug Log References
### Completion Notes List
### File List
