# Story 6.4c: Server Dependency Cleanup

Status: ready-for-dev

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
7. No `webApi` calls remain in the extension outside of: (a) email pages (Story 6.4b scope), (b) Unlock.tsx server vault calls (Story 6.4a scope), (c) gated mobile-login code
8. All tests pass, extension builds for preprod

## Tasks / Subtasks

- [ ] Task 1: Remove revokeTokens from logout (AC: #1)
  - [ ] 1.1 In `AppContext.tsx` line ~43, remove `await webApi.revokeTokens();`
  - [ ] 1.2 Keep `auth.clearAuth(errorMessage)` and the rest of the logout flow
  - [ ] 1.3 If `webApi` is no longer imported by AppContext after this removal, clean up the import

- [ ] Task 2: Remove favicon server extraction from credential creation (AC: #2)
  - [ ] 2.1 In `CredentialAddEdit.tsx` lines ~580-598, remove the entire favicon extraction try-catch block (the `webApi.get('Favicon/Extract?url=...')` call with Promise.race timeout)
  - [ ] 2.2 Leave `data.Logo` as `undefined` — credential will display with default/fallback icon
  - [ ] 2.3 Optionally: replace with client-side favicon: `<img src="${new URL(serviceUrl).origin}/favicon.ico" />` at render time (no fetch needed at save time)
  - [ ] 2.4 Clean up `webApi` import from CredentialAddEdit if no longer used

- [ ] Task 3: Remove favicon server extraction from passkey creation (AC: #3)
  - [ ] 3.1 In `PasskeyCreate.tsx` lines ~202-222, remove the entire favicon extraction try-catch block
  - [ ] 3.2 Leave `faviconLogo` as `undefined`
  - [ ] 3.3 Clean up `webApi` import

- [ ] Task 4: Remove deprecated handleSyncVault and SYNC_VAULT handler (AC: #4)
  - [ ] 4.1 In `VaultMessageHandler.ts`, delete the entire `handleSyncVault()` function (lines ~135-168, marked `@deprecated`)
  - [ ] 4.2 In `background.ts` line ~47, remove `onMessage('SYNC_VAULT', () => handleSyncVault());`
  - [ ] 4.3 Remove the `handleSyncVault` import from `background.ts` line ~12
  - [ ] 4.4 Search for any remaining `SYNC_VAULT` message senders — should be zero (grep confirmed no callers)

- [ ] Task 5: Remove server URL configuration from AuthSettings (AC: #5)
  - [ ] 5.1 In `AuthSettings.tsx`, remove the "Server Configuration" section (lines ~176-247) — the dropdown for "AliasVault.net" / "Self-hosted" and the custom URL input fields
  - [ ] 5.2 Remove related state variables and handler functions that manage `apiUrl` / `clientUrl` storage
  - [ ] 5.3 Keep the rest of AuthSettings (wallet address display, version info, logout button, etc.)
  - [ ] 5.4 Remove `ApiUrlUtility.ts` import if no longer needed
  - [ ] 5.5 Clean up `DEFAULT_API_URL` / `DEFAULT_CLIENT_URL` references if they become orphaned

- [ ] Task 6: Gate mobile unlock UI (AC: #6)
  - [ ] 6.1 In `Unlock.tsx`, find the mobile unlock button (line ~557-566) and the `MobileUnlockModal` component — wrap in `{false && ...}` or remove the render
  - [ ] 6.2 Keep `MobileLoginUtility.ts` and `MobileUnlockModal.tsx` source files (don't delete — mobile may be implemented later)
  - [ ] 6.3 Remove or gate the mobile-related `showMobileUnlockModal` state and handler in Unlock.tsx
  - [ ] 6.4 Add comment: `// Mobile unlock requires server — disabled until mobile app supports wallet auth`

- [ ] Task 7: Final sweep and verify (AC: #7, #8)
  - [ ] 7.1 Search all `.tsx` and `.ts` files for remaining `webApi` usage — verify each remaining call is in 6.4a scope (Unlock vault fetch), 6.4b scope (email pages), or gated mobile code
  - [ ] 7.2 Run `pnpm run test` in `apps/browser-extension/` — all tests pass
  - [ ] 7.3 Build with `VITE_MIDNIGHT_NETWORK=preprod` — succeeds
  - [ ] 7.4 Load extension — no console errors on startup

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

- `WebApiService.ts` — keep file (still used by email pages until 6.4b, and mobile code)
- `WebApiContext.tsx` — keep provider
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
### Debug Log References
### Completion Notes List
### File List
