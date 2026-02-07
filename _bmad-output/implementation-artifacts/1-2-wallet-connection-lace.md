# Story 1.2: Wallet Connection (Lace)

Status: done

---

## Story

**As a** user  
**I want** to connect my Cardano wallet (Lace)  
**So that** I can authenticate without a username/password

---

## Acceptance Criteria

1. ~~Wallet selection modal shows available wallets~~ → **SCOPE CHANGE**: Single "Connect Lace Wallet" button instead of modal. Nami dropped from MVP scope — Lace is the only Midnight-compatible wallet.
2. User can connect Lace wallet → **DONE**
3. ~~User can connect Nami wallet~~ → **DESCOPED**: Nami does not support Midnight. Lace-only for MVP.
4. Wallet address is displayed after connection → **DONE**: Truncated address shown in green badge
5. Connection persists across browser sessions → **DONE**: Persisted to `local:walletState`

---

## Tasks / Subtasks

- [x] **Task 1: Background Wallet Handler** (AC: #2)
  - [x] 1.1: Create `WalletMessageHandler.ts` in background scripts
  - [x] 1.2: Implement `handleDetectLaceWallet()` — inject script into MAIN world to check `window.midnight.mnLace`
  - [x] 1.3: Implement `handleConnectLaceWallet()` — call `lace.connect(networkId)` with Lace v4+ API
  - [x] 1.4: Return `WalletResult<T>` objects (never throw — webext-bridge limitation)
  - [x] 1.5: Validate tab URL is http/https before script injection

- [x] **Task 2: Wallet Context Provider** (AC: #4, #5)
  - [x] 2.1: Create `WalletContext.tsx` with `useWallet()` hook
  - [x] 2.2: Implement `connectWallet()` — sends message to background, stores result
  - [x] 2.3: Implement `disconnectWallet()` — clears state and storage
  - [x] 2.4: Persist wallet state to `local:walletState` via extension storage API
  - [x] 2.5: Restore wallet state from storage on mount

- [x] **Task 3: Login UI Integration** (AC: #1, #4)
  - [x] 3.1: Add purple "Connect Lace Wallet" button to Login.tsx
  - [x] 3.2: Show green connected badge with truncated address after connection
  - [x] 3.3: Add disconnect button
  - [x] 3.4: Add i18n keys for all wallet UI strings

- [x] **Task 4: Background Message Registration** (AC: #2)
  - [x] 4.1: Register `DETECT_LACE_WALLET`, `CONNECT_LACE_WALLET`, `GET_WALLET_SERVICE_URIS` in `background.ts`

---

## Dev Notes

### Key Technical Decisions

- **Lace v4+ API**: Uses `connect(networkId)` not `enable()`, and `getShieldedAddresses()` not `state()`. The Midnight docs show the old API.
- **MAIN world injection**: Extension popup cannot access `window.midnight` directly — must inject via `chrome.scripting.executeScript({ world: "MAIN" })` in the background script.
- **Result objects over throws**: webext-bridge does NOT propagate thrown errors reliably between background and popup. All handlers return `{ success, data?, error? }`.
- **Network**: Hardcoded to `'undeployed'` for local dev (now sourced from shared `networkConfig.ts`).

---

## Dev Agent Record

### Agent Model Used

Multiple sessions (Cascade / Claude) — implemented outside BMAD flow, retroactively documented.

### Completion Notes List

- Nami wallet support dropped — Nami doesn't support Midnight blockchain
- Wallet selection modal replaced with single Lace connect button
- Lace v4+ API discovered through trial-and-error (docs were outdated)

### Change Log

| Date | Author | Description |
|------|--------|-------------|
| 2026-01-12 | Ozi3o | Initial implementation (commit 658a1324) |
| 2026-01-12 | Ozi3o | Fix Lace v4+ API (commit 523c77be) |
| 2026-02-07 | Amelia (CR) | Code review: removed dead code, fixed any types, extracted network config |

### File List

**Created:**
- `apps/browser-extension/src/entrypoints/background/WalletMessageHandler.ts`
- `apps/browser-extension/src/entrypoints/popup/context/WalletContext.tsx`
- `apps/browser-extension/src/entrypoints/popup/config/networkConfig.ts` (added in CR)

**Modified:**
- `apps/browser-extension/src/entrypoints/background.ts` — Added wallet message handlers
- `apps/browser-extension/src/entrypoints/popup/main.tsx` — Added WalletProvider
- `apps/browser-extension/src/entrypoints/popup/pages/auth/Login.tsx` — Wallet connect UI
- `apps/browser-extension/src/i18n/locales/en.json` — Wallet i18n keys

### Senior Developer Review (AI)

**Reviewed:** 2026-02-07 by Amelia (Dev Agent)

**Issues Found:** 2 High, 4 Medium, 2 Low
**Issues Fixed:** 2 High (AC scope documented), 3 Medium (dead code, any types, network config), 1 Low (dead constant)

**Remaining Action Items:**
- [x] [AI-Review][MEDIUM] Unit tests added for WalletService.ts (9 tests), networkConfig.ts (2 tests), explorerConfig.ts (5 tests)
- [ ] [AI-Review][MEDIUM] WalletMessageHandler.ts and WalletContext.tsx need integration tests (browser API mocking required)
- [ ] [AI-Review][LOW] `shieldedAddress` field naming — verify semantics match Midnight's address model
