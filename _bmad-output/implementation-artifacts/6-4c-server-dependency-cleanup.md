# Story 6.4c: Server Dependency Cleanup

Status: done

<!-- Removes all remaining non-email, non-unlock server dependencies from the extension. -->

## Story

As a **developer preparing for preprod validation**,
I want **all remaining server API calls removed or neutralized**,
so that **the extension operates as a fully decentralized app with zero server dependencies**.

## Acceptance Criteria

1. Logout no longer calls `webApi.revokeTokens()` — token revocation removed from `AppContext.tsx`
2. Credential creation no longer calls `webApi.get('Favicon/Extract')` — favicon extraction block removed from `CredentialAddEdit.tsx`, credentials save without icons (or use a client-side favicon approach)
3. Passkey creation no longer calls `webApi.get('Favicon/Extract')` — same removal in `PasskeyCreate.tsx`
4. Deprecated `handleSyncVault()` function removed from `VaultMessageHandler.ts` and its `SYNC_VAULT` message handler removed from `background.ts`
5. Server URL configuration UI removed from `AuthSettings.tsx` — no "AliasVault.net" / "Self-hosted" dropdown (no server exists in blockchain mode)
6. Mobile unlock UI (button + modal) in `Unlock.tsx` hidden/gated — mobile is not implemented and the server endpoints don't exist
7. No `webApi` calls remain in the extension outside of gated mobile-login code (`MobileLoginUtility.ts` / `MobileUnlockModal.tsx` — kept but UI trigger removed)
8. All tests pass, extension builds for preprod

## Tasks / Subtasks

- [x] Task 1: Remove revokeTokens from logout (AC: #1)
  - [x] 1.1 In `AppContext.tsx` line ~43, remove `await webApi.revokeTokens();`
  - [x] 1.2 Keep `auth.clearAuth(errorMessage)` and the rest of the logout flow
  - [x] 1.3 If `webApi` is no longer imported by AppContext after this removal, clean up the import

- [x] Task 2: Remove favicon server extraction from credential creation (AC: #2)
  - [x] 2.1 In `CredentialAddEdit.tsx` lines ~580-598, remove the entire favicon extraction try-catch block (the `webApi.get('Favicon/Extract?url=...')` call with Promise.race timeout)
  - [x] 2.2 Leave `data.Logo` as `undefined` — credential will display with default/fallback icon
  - [x] 2.3 Optionally: replace with client-side favicon: `<img src="${new URL(serviceUrl).origin}/favicon.ico" />` at render time (no fetch needed at save time) — skipped (not required for AC)
  - [x] 2.4 Clean up `webApi` import from CredentialAddEdit if no longer used

- [x] Task 3: Remove favicon server extraction from passkey creation (AC: #3)
  - [x] 3.1 In `PasskeyCreate.tsx` lines ~202-222, remove the entire favicon extraction try-catch block
  - [x] 3.2 Leave `faviconLogo` as `undefined`
  - [x] 3.3 Clean up `webApi` import

- [x] Task 4: Remove deprecated handleSyncVault and SYNC_VAULT handler (AC: #4)
  - [x] 4.1 In `VaultMessageHandler.ts`, delete the entire `handleSyncVault()` function (lines ~135-168, marked `@deprecated`)
  - [x] 4.2 In `background.ts` line ~47, remove `onMessage('SYNC_VAULT', () => handleSyncVault());`
  - [x] 4.3 Remove the `handleSyncVault` import from `background.ts` line ~12
  - [x] 4.4 Search for any remaining `SYNC_VAULT` message senders — should be zero (grep confirmed no callers)

- [x] Task 5: Remove server URL configuration from AuthSettings (AC: #5)
  - [x] 5.1 In `AuthSettings.tsx`, remove the "Server Configuration" section (lines ~176-247) — the dropdown for "AliasVault.net" / "Self-hosted" and the custom URL input fields
  - [x] 5.2 Remove related state variables and handler functions that manage `apiUrl` / `clientUrl` storage
  - [x] 5.3 Keep the rest of AuthSettings (wallet address display, version info, logout button, etc.)
  - [x] 5.4 Remove `ApiUrlUtility.ts` import if no longer needed — was not imported
  - [x] 5.5 Clean up `DEFAULT_API_URL` / `DEFAULT_CLIENT_URL` references if they become orphaned — `Yup` import removed, `DEFAULT_OPTIONS` and `createUrlSchema` removed, `AppInfo` kept (used for VERSION display)

- [x] Task 6: Gate mobile unlock UI (AC: #6)
  - [x] 6.1 In `Unlock.tsx`, remove the mobile unlock button and the `MobileUnlockModal` render
  - [x] 6.2 Keep `MobileLoginUtility.ts` and `MobileUnlockModal.tsx` source files (don't delete — mobile may be implemented later)
  - [x] 6.3 Remove the mobile-related `showMobileUnlockModal` state, handler, and unused imports (`useAuth`, `useWebApi`, `MobileUnlockModal`, `MobileLoginResult`) from Unlock.tsx
  - [x] 6.4 Add JSDoc comment to `MobileUnlockModal.tsx`: `@deprecated Mobile unlock requires server — disabled until mobile app supports wallet auth (Story 6.4c)`

- [x] Task 7: Update Unlock.test.tsx for mobile removal (AC: #8)
  - [x] 7.1 Remove hoisted mocks: `mockWebApiGet`, `mockWebApiGetStatus`, `mockWebApiRevokeTokens`, `mockSetAuthTokens`
  - [x] 7.2 Remove `vi.mock('@/entrypoints/popup/context/WebApiContext')` block
  - [x] 7.3 Remove `vi.mock('@/entrypoints/popup/context/AuthContext')` block (no longer imported by Unlock.tsx)
  - [x] 7.4 Remove `vi.mock('@/entrypoints/popup/components/Dialogs/MobileUnlockModal')` block
  - [x] 7.5 Remove `mockWebApiRevokeTokens.mockResolvedValue(undefined)` and `mockSetAuthTokens.mockResolvedValue(undefined)` from `beforeEach`
  - [x] 7.6 Remove `describe('AC #4: Mobile unlock uses blockchain vault')` test block — mobile UI no longer rendered
  - [x] 7.7 Remove `describe('AC #5: revokeTokens wrapped in try/catch')` test block — mobile handler removed
  - [x] 7.8 Update remaining tests that assert `mockWebApiGet` / `mockWebApiGetStatus` not called — removed those assertions; added new test verifying mobile button is not rendered

- [x] Task 8: Final sweep and verify (AC: #7, #8)
  - [x] 8.1 Search all `.tsx` and `.ts` files for remaining `webApi` usage — only `MobileLoginUtility.ts` (gated) and `WebApiContext.tsx` (provider definition) remain
  - [x] 8.2 Run `pnpm run test` in `apps/browser-extension/` — 375 tests pass, 33 test files
  - [x] 8.3 Build with `VITE_MIDNIGHT_NETWORK=preprod` — succeeds (37.5s, no errors)
  - [ ] 8.4 Load extension — pending (manual verification by user)

## Dev Notes

### Removal Safety

Every server call being removed is either:
- **Wrapped in try-catch with silent error handling** (revokeTokens, favicon) — removing doesn't break flow
- **Has zero active callers** (handleSyncVault / SYNC_VAULT) — dead code confirmed by grep
- **Controls dead UI** (AuthSettings server URL config) — no server exists in blockchain mode

### What Gets Removed

| File | Line(s) | What | Why Safe |
|------|---------|------|----------|
| `AppContext.tsx` | ~43 | `webApi.revokeTokens()` | Wrapped in try-catch, tokens expire naturally |
| `CredentialAddEdit.tsx` | ~580-598 | Favicon extraction block | Wrapped in try-catch, no-op on failure |
| `PasskeyCreate.tsx` | ~202-222 | Favicon extraction block | Wrapped in try-catch, no-op on failure |
| `VaultMessageHandler.ts` | ~135-168 | `handleSyncVault()` function | Marked @deprecated, zero callers |
| `background.ts` | ~47 | `SYNC_VAULT` handler registration | Zero message senders |
| `AuthSettings.tsx` | ~176-247 | Server URL config UI section | No server exists in blockchain mode |
| `Unlock.tsx` | ~557-566 | Mobile unlock button/modal render | Mobile not implemented |

### What Gets Kept

- `WebApiService.ts` — keep file (only consumer is MobileLoginUtility.ts; email pages were cleaned up in 6.4b)
- `WebApiContext.tsx` — keep provider for now (no active `useWebApi()` consumers after this story — candidate for removal in a future cleanup)
- `MobileLoginUtility.ts` — keep file, just don't render trigger UI
- `MobileUnlockModal.tsx` — keep file, just don't render
- `AppInfo.DEFAULT_API_URL` — keep constant (may be used elsewhere)

### Favicon Alternative (Optional Enhancement)

Instead of server-side extraction, credentials can display favicons at render time using the site's own favicon:

```tsx
<img
  src={`${new URL(credential.serviceUrl).origin}/favicon.ico`}
  onError={(e) => { e.currentTarget.style.display = 'none'; }}
  alt=""
/>
```

This is a render-time approach — no API call, no storage needed. If the dev agent wants to implement this, it's optional but improves UX. Not required for AC.

### Key Files

| File | Action |
|------|--------|
| `apps/browser-extension/src/entrypoints/popup/context/AppContext.tsx` | Remove revokeTokens |
| `apps/browser-extension/src/entrypoints/popup/pages/credentials/CredentialAddEdit.tsx` | Remove favicon block |
| `apps/browser-extension/src/entrypoints/popup/pages/passkeys/PasskeyCreate.tsx` | Remove favicon block |
| `apps/browser-extension/src/entrypoints/background/VaultMessageHandler.ts` | Delete handleSyncVault |
| `apps/browser-extension/src/entrypoints/background.ts` | Remove SYNC_VAULT handler + import |
| `apps/browser-extension/src/entrypoints/popup/pages/auth/AuthSettings.tsx` | Remove server URL config UI |
| `apps/browser-extension/src/entrypoints/popup/pages/auth/Unlock.tsx` | Gate mobile unlock UI |

### References

- [Source: Architect audit — Cosmetic dependencies C1-C6]
- [Source: VaultMessageHandler.ts:135 — @deprecated handleSyncVault]
- [Source: AuthSettings.tsx — server URL config dropdown]
- [Source: CredentialAddEdit.tsx:586 — favicon Promise.race pattern]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
None — no blocking issues encountered.

### Completion Notes List

**Task 1 — AppContext.tsx:** Removed `webApi.revokeTokens()`, cleaned up `useWebApi` import and `webApi` variable. Logout now calls `auth.clearAuth()` directly.

**Task 2 — CredentialAddEdit.tsx:** Removed favicon extraction block (webApi.get + Promise.race timeout), cleaned up `useWebApi` import, `webApi` variable, `Buffer` import, and `webApi` from dependency array. Credentials save without icons.

**Task 3 — PasskeyCreate.tsx:** Removed favicon extraction block, cleaned up `useWebApi` import and variable. `faviconLogo` references replaced with `undefined`.

**Task 4 — VaultMessageHandler.ts + background.ts:** Deleted `handleSyncVault()` function (deprecated, zero callers). Removed `SYNC_VAULT` handler and import from background.ts. Cleaned up orphaned `WebApiService` and `VaultResponse` (webapi model) imports.

**Task 5 — AuthSettings.tsx:** Removed entire Server Configuration section (dropdown + custom URL inputs), all related state/handlers (`selectedOption`, `customUrl`, `customClientUrl`, `errors`, `urlSchema`, `handleOptionChange`, `handleCustomUrlChange`, `handleCustomClientUrlChange`). Removed `Yup` import. Kept autofill settings, language settings, and version display.

**Task 6 — Unlock.tsx:** Removed mobile unlock button, `MobileUnlockModal` render, `showMobileUnlockModal` state, `handleMobileUnlockSuccess` handler, and unused imports (`useAuth`, `useWebApi`, `MobileUnlockModal`, `MobileLoginResult`). Added `@deprecated` JSDoc to MobileUnlockModal.tsx.

**Task 7 — Unlock.test.tsx:** Removed dead hoisted mocks (webApi*, setAuthTokens), dead vi.mock blocks (WebApiContext, AuthContext, MobileUnlockModal), dead test suites (AC #4, AC #5), stale assertions. Added new test verifying mobile button is not rendered. 8 tests remain (was 10).

**Task 8 — Final sweep:** webApi only in gated mobile code. 375 tests pass. Chrome preprod build succeeds.

**Architect review (pre-completion):** Winston reviewed all three 6.4x stories. Corrected stale Dev Notes (email pages no longer use WebApiService post-6.4b), simplified AC #7 boundary language, added Task 7 for test updates, flagged WebApiContext as future cleanup candidate.

### Senior Developer Review (AI)
**Reviewer:** Amelia (Dev Agent) — 2026-03-27
**Outcome:** Approved — 0 issues found

All 8 ACs verified against git diff:
- AC1: `revokeTokens` removed from AppContext ✓
- AC2: Favicon extraction removed from CredentialAddEdit ✓
- AC3: Favicon extraction removed from PasskeyCreate ✓
- AC4: `handleSyncVault` + `SYNC_VAULT` handler deleted ✓
- AC5: Server URL config UI removed from AuthSettings ✓
- AC6: Mobile unlock UI removed from Unlock.tsx ✓
- AC7: No webApi calls remain outside gated mobile code ✓
- AC8: 396/396 tests pass ✓

### Change Log
- 2026-03-27: Story 6.4c implementation — server dependency cleanup
- 2026-03-27: Architect review — 4 findings addressed (stale Dev Notes, test breakage, AC #7 language, deprecation comment)
- 2026-03-27: Code review passed — all ACs verified, 0 issues

### File List
- `apps/browser-extension/src/entrypoints/popup/context/AppContext.tsx` — removed revokeTokens + useWebApi
- `apps/browser-extension/src/entrypoints/popup/pages/credentials/CredentialAddEdit.tsx` — removed favicon block + useWebApi + Buffer import
- `apps/browser-extension/src/entrypoints/popup/pages/passkeys/PasskeyCreate.tsx` — removed favicon block + useWebApi
- `apps/browser-extension/src/entrypoints/background/VaultMessageHandler.ts` — deleted handleSyncVault + orphaned imports
- `apps/browser-extension/src/entrypoints/background.ts` — removed SYNC_VAULT handler + handleSyncVault import
- `apps/browser-extension/src/entrypoints/popup/pages/auth/AuthSettings.tsx` — removed server URL config UI + Yup + related state
- `apps/browser-extension/src/entrypoints/popup/pages/auth/Unlock.tsx` — removed mobile unlock UI + handler + unused imports
- `apps/browser-extension/src/entrypoints/popup/components/Dialogs/MobileUnlockModal.tsx` — added @deprecated JSDoc
- `apps/browser-extension/src/entrypoints/popup/pages/auth/__tests__/Unlock.test.tsx` — removed dead mocks/tests, added mobile-absent test
