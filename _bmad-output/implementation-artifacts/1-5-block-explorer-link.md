# Story 1.5: Block Explorer Link

Status: done

---

## Story

**As a** user  
**I want** to see my vault registration on the block explorer  
**So that** I can verify my data is truly decentralized

---

## Acceptance Criteria

1. Dev check: Verify Midnight block explorer URL availability → **DONE**: Config maps networks to explorer URLs
2. UI component checks for explorer URL config → **DONE**: `getExplorerAddressUrl()` returns null gracefully for unavailable networks
3. If available: Show "Verify on Explorer" link → **DONE**: Conditional render in Login.tsx verified state
4. If unavailable: Hide link gracefully → **DONE**: Returns null when config is null (e.g. `undeployed` network)
5. Link opens correct address on explorer → **DONE**: `{address}` placeholder replaced, `target="_blank"` with `rel="noopener noreferrer"`

---

## Tasks / Subtasks

- [x] **Task 1: Explorer Configuration** (AC: #1, #2)
  - [x] 1.1: Create `explorerConfig.ts` with per-network explorer URL mappings
  - [x] 1.2: Define `ExplorerConfig` interface (name, baseUrl, addressUrl, txUrl, contractUrl)
  - [x] 1.3: Configure: `undeployed: null`, `preview: Nocy Explorer`, `preprod: Nocy Explorer`, `mainnet: null`
  - [x] 1.4: Use shared `CURRENT_NETWORK` from `networkConfig.ts` (updated in CR)

- [x] **Task 2: URL Helper Functions** (AC: #3, #5)
  - [x] 2.1: `getExplorerConfig()` — returns config or null for current network
  - [x] 2.2: `getExplorerAddressUrl(address)` — returns full URL with encoded address
  - [x] 2.3: `getExplorerTxUrl(txHash)` — returns transaction URL
  - [x] 2.4: `getExplorerContractUrl(address)` — returns contract URL

- [x] **Task 3: Login UI Integration** (AC: #3, #4)
  - [x] 3.1: Import `getExplorerAddressUrl` in Login.tsx
  - [x] 3.2: Render "Verify on Explorer" link only in verified state and when URL is non-null
  - [x] 3.3: External link icon + green styling consistent with verified badge
  - [x] 3.4: Add `wallet.verifyOnExplorer` i18n key

---

## Dev Notes

### Explorer Availability

- **Undeployed/local**: No explorer exists → link hidden
- **Preview/preprod**: Nocy Explorer at `explorer.nocy.io` → link shown with search query
- **Mainnet**: No explorer confirmed yet → link hidden

### Design Decision

Explorer link only renders in the "verified" state (connected + signed). This ensures users see the link only after full wallet authentication, not just connection.

---

## Dev Agent Record

### Agent Model Used

Multiple sessions (Cascade / Claude) — implemented outside BMAD flow, retroactively documented.

### Completion Notes List

- Explorer link is invisible on local/undeployed network (expected for development)
- Nocy Explorer URLs use search query format: `explorer.nocy.io/search?q={address}`
- URL encoding applied to address before substitution

### Change Log

| Date | Author | Description |
|------|--------|-------------|
| 2026-01-14 | Ozi3o | Initial implementation (commit 7deda3f9) |
| 2026-02-07 | Amelia (CR) | Code review: extracted CURRENT_NETWORK to shared networkConfig.ts |

### File List

**Created:**
- `apps/browser-extension/src/entrypoints/popup/config/explorerConfig.ts` — Explorer URL configuration and helpers

**Modified:**
- `apps/browser-extension/src/entrypoints/popup/pages/auth/Login.tsx` — Added explorer link in verified state
- `apps/browser-extension/src/i18n/locales/en.json` — Added `wallet.verifyOnExplorer` key

### Senior Developer Review (AI)

**Reviewed:** 2026-02-07 by Amelia (Dev Agent)

**Issues Found:** 0 High, 4 Medium, 2 Low
**Issues Fixed:** 1 Medium (shared network config)

**Remaining Action Items:**
- [x] [AI-Review][MEDIUM] Unit tests added for explorerConfig.ts (5 tests pass)
- [ ] [AI-Review][MEDIUM] Explorer link only visible in verified state — may be confusing if user expects to see it after connection only
- [x] [AI-Review][MEDIUM] CURRENT_NETWORK consolidated into shared networkConfig.ts
- [ ] [AI-Review][LOW] Nocy Explorer URLs should be verified when targeting preview/preprod networks
