# Story 1.6: Remove SRP Auth Flow

Status: done

---

## Story

**As a** developer  
**I want** to remove the legacy SRP authentication  
**So that** the codebase relies purely on wallet authentication

---

## Acceptance Criteria

1. **DELETE:** All SRP-related code in `WebApiService.ts` → **DONE**: SRP flows removed
2. **DELETE:** SRP encryption helpers in `EncryptionUtility.ts` → **DONE**: `SrpUtility.ts` deleted entirely (151 lines)
3. **DELETE:** SRP data models → **DONE**: SRP-related imports and logic removed from Login.tsx, Unlock.tsx, useVaultSync.ts
4. New `WalletService.ts` created to handle auth state → **DONE**: Created in `services/WalletService.ts`

---

## Tasks / Subtasks

- [x] **Task 1: Delete SRP Code** (AC: #1, #2, #3)
  - [x] 1.1: Delete `apps/browser-extension/src/entrypoints/popup/utils/SrpUtility.ts` (151 lines of SRP protocol code)
  - [x] 1.2: Remove SRP-related imports and logic from `Login.tsx` (483 lines removed — username/password form, 2FA, mobile login all gone)
  - [x] 1.3: Remove SRP dependency from `Unlock.tsx` — uses locally stored encryption params instead
  - [x] 1.4: Remove SRP salt change detection from `useVaultSync.ts`

- [x] **Task 2: Create WalletService** (AC: #4)
  - [x] 2.1: Create `WalletService.ts` in `services/` for wallet auth state management
  - [x] 2.2: Define `WalletAuthState` interface (isConnected, isVerified, walletAddress, networkId)
  - [x] 2.3: Implement `getNetworkId()`, `createInitialAuthState()`, `createAuthenticatedState()`, `isAuthenticated()`
  - [x] 2.4: Use shared `CURRENT_NETWORK` from `networkConfig.ts` (updated in CR)

- [x] **Task 3: Login.tsx Rewrite** (AC: #1, #4)
  - [x] 3.1: Wallet-only Login.tsx — Connect → Sign → Verified flow
  - [x] 3.2: Three UI states: Not connected, Connected (needs signing), Verified
  - [x] 3.3: Explorer link integration from Story 1.5

---

## Dev Notes

### Impact Assessment

- **Build size**: Dropped from 2.79 MB to 2.75 MB (SRP library removed)
- **Login.tsx**: Reduced from ~660 lines to ~177 lines
- **Auth model**: Fully wallet-based — no more username/password/2FA

### What Was Removed

- `SrpUtility.ts` — Complete SRP-6a protocol implementation (generate verifier, derive session key, etc.)
- Login form fields (username, password, 2FA code, mobile login link)
- SRP handshake logic (client → server challenge-response)
- Salt change detection in vault sync

### What Was Preserved

- `Unlock.tsx` — Still uses locally stored encryption key derivation params (Master Password for vault encryption is separate from auth)
- `useVaultSync.ts` — Vault sync logic kept, only SRP-specific salt checking removed

---

## Dev Agent Record

### Agent Model Used

Multiple sessions (Cascade / Claude) — implemented outside BMAD flow, retroactively documented.

### Completion Notes List

- SRP removal was clean — no orphaned references
- WalletService.ts provides non-React auth state management for services that can't use hooks
- Master Password for vault encryption is independent of SRP auth — it remains functional via Unlock.tsx

### Change Log

| Date | Author | Description |
|------|--------|-------------|
| 2026-02-07 | Ozi3o | Initial implementation (commit 4001fd6d) |
| 2026-02-07 | Amelia (CR) | Code review: updated WalletService.ts to use shared networkConfig |

### File List

**Created:**
- `apps/browser-extension/src/entrypoints/popup/services/WalletService.ts` — Wallet auth state management

**Deleted:**
- `apps/browser-extension/src/entrypoints/popup/utils/SrpUtility.ts` — SRP protocol (151 lines)

**Modified:**
- `apps/browser-extension/src/entrypoints/popup/pages/auth/Login.tsx` — Wallet-only auth (483 lines removed)
- `apps/browser-extension/src/entrypoints/popup/pages/auth/Unlock.tsx` — Removed SRP dependency
- `apps/browser-extension/src/entrypoints/popup/hooks/useVaultSync.ts` — Removed SRP salt detection
- `apps/browser-extension/src/i18n/locales/en.json` — Updated auth strings

### Senior Developer Review (AI)

**Reviewed:** 2026-02-07 by Amelia (Dev Agent)

**Issues Found:** 0 High, 1 Medium, 1 Low
**Issues Fixed:** 1 Medium (WalletService.ts hardcoded network ID → shared config)

**Remaining Action Items:**
- [ ] [AI-Review][LOW] No unit tests for WalletService.ts utility functions
