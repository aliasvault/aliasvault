# Story 1.3: Wallet Signature Challenge

Status: done

---

## Story

**As a** user  
**I want** to sign a challenge with my wallet  
**So that** I can prove ownership of my Identity and unlock my vault

---

## Acceptance Criteria

1. System generates unique challenge message → **DONE**: `AliasVault-Auth:{nonce}:{timestamp}` with crypto.getRandomValues
2. Wallet prompts user to sign message → **PARTIAL**: Attempts `signData()`, falls back to connection-proof if unavailable
3. ~~Signature is verified client-side~~ → **DEFERRED**: No cryptographic verification implemented. Lace `signData()` API returns implementation-specific results without a documented verification scheme. The `authMethod` field now distinguishes between real signatures and connection-proof fallbacks.
4. Failed signature shows error message → **DONE**: Error state propagated to UI
5. Successful signature proceeds to unlock flow → **PARTIAL**: Sets `isVerified=true` in WalletContext. Full vault unlock integration deferred to Epic 2.

---

## Tasks / Subtasks

- [x] **Task 1: Challenge Generation** (AC: #1)
  - [x] 1.1: Generate crypto-random 16-byte nonce via `crypto.getRandomValues`
  - [x] 1.2: Format challenge as `AliasVault-Auth:{nonce}:{timestamp}`
  - [x] 1.3: Challenge generated fresh per signing attempt (not reused)

- [x] **Task 2: Signing Flow** (AC: #2)
  - [x] 2.1: Implement `handleSignChallenge()` in WalletMessageHandler.ts
  - [x] 2.2: Pass challenge string to injected script as argument
  - [x] 2.3: Try `api.signData(payload)` first (Lace v4+ feature)
  - [x] 2.4: Fall back to `connection-proof:{address}:{challenge}` if signData unavailable/fails
  - [x] 2.5: Add `authMethod` field to distinguish signature vs connection-proof (added in CR)
  - [x] 2.6: Validate signData result is non-empty and not malformed (added in CR)

- [x] **Task 3: Context Integration** (AC: #4, #5)
  - [x] 3.1: Add `signChallenge()` to WalletContext
  - [x] 3.2: Track `isSigning` and `isVerified` states
  - [x] 3.3: Store `SignatureResult` including authMethod

- [x] **Task 4: Login UI** (AC: #4)
  - [x] 4.1: "Sign Challenge to Verify" button appears after wallet connection
  - [x] 4.2: Button disabled during signing, shows "Signing..." text
  - [x] 4.3: Green verified badge with shield icon after success
  - [x] 4.4: Error message displayed on failure

---

## Dev Notes

### Security Considerations

- **Connection-proof fallback is NOT cryptographic**: When `signData()` is unavailable (current Lace versions), the fallback `connection-proof:{address}:{challenge}` only proves the user approved the DApp connection via the Lace popup. It does NOT prove they signed this specific challenge. This is acceptable for MVP but must be upgraded when Lace fully supports `signData()`.
- **`authMethod` field**: Added during code review to make the auth level transparent. Consumers should check this field and apply appropriate trust levels.
- **No server-side verification**: All verification is client-side. This is acceptable for a local-first app where the threat model is "protect user's own vault" not "authenticate to a server".

---

## Dev Agent Record

### Agent Model Used

Multiple sessions (Cascade / Claude) — implemented outside BMAD flow, retroactively documented.

### Completion Notes List

- Lace `signData()` API exists but may not be fully implemented in all wallet versions
- The connection-proof fallback was a pragmatic choice to unblock development
- Full cryptographic verification requires knowing Lace's exact signature scheme (Ed25519? ECDSA?)

### Change Log

| Date | Author | Description |
|------|--------|-------------|
| 2026-01-12 | Ozi3o | Initial implementation (commit c8724212) |
| 2026-02-07 | Amelia (CR) | Code review: added authMethod field, signData validation, network config via args, documented security implications |

### File List

**Modified:**
- `apps/browser-extension/src/entrypoints/background/WalletMessageHandler.ts` — Added `handleSignChallenge()`, `SignChallengeResult` with `authMethod`
- `apps/browser-extension/src/entrypoints/popup/context/WalletContext.tsx` — Added `signChallenge()`, `SignatureResult` with `authMethod`
- `apps/browser-extension/src/entrypoints/popup/pages/auth/Login.tsx` — Sign challenge button + verified state UI
- `apps/browser-extension/src/entrypoints/background.ts` — Registered `SIGN_CHALLENGE` handler
- `apps/browser-extension/src/i18n/locales/en.json` — Signing-related i18n keys

### Senior Developer Review (AI)

**Reviewed:** 2026-02-07 by Amelia (Dev Agent)

**Issues Found:** 2 High, 4 Medium, 1 Low
**Issues Fixed:** 2 High (authMethod transparency, signData validation), 3 Medium (network config, duplicate connect documented, challenge tracking)

**Remaining Action Items:**
- [ ] [AI-Review][HIGH] Implement proper cryptographic verification when Lace signData() API is stable
- [ ] [AI-Review][MEDIUM] No unit tests for challenge generation or signing flow
- [ ] [AI-Review][MEDIUM] Challenge not persisted for potential server-side verification in future
