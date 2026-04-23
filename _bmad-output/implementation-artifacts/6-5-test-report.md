# Story 6.5 Preprod Smoke Test Report

Date: 2026-03-28
Extension Build: VITE_MIDNIGHT_NETWORK=preprod
Lace Wallet Version: v4+ (DApp Connector API)
Proof Server: configurable via VITE_PROOF_SERVER_URL (env override)

## Results Summary

| AC# | Flow | Status | Notes |
|-----|------|--------|-------|
| 1 | Extension build | ✅ PASS | Build successful after fixing 3 blocking bugs |
| 2 | Wallet connection | ✅ PASS | Lace wallet detected, connected, master password created |
| 3 | Credential CRUD + sync | ⚠️ PARTIAL | Local CRUD works, autofill works. Blockchain upload BLOCKED (missing providers) |
| 4 | Alias generation | ⬜ BLOCKED | Requires on-chain write (findDeployedContract) |
| 5 | Relay authorization | ⬜ BLOCKED | Requires on-chain write |
| 6 | Guardian setup | ⬜ BLOCKED | Requires on-chain write |
| 7 | Multi-device sync | ⬜ BLOCKED | Requires vault uploaded to blockchain first |
| 8 | Conflict resolution | ⬜ BLOCKED | Requires vault uploaded to blockchain first |
| 9 | No console errors | ❌ FAIL | 3 error categories (see below) |

## Detailed Results

### AC 1: Extension Build
- Build command: `pnpm run build:chrome` (with `.env` containing `VITE_MIDNIGHT_NETWORK=preprod`)
- Duration: ~40s
- Network config: preprod URLs from networkConfig.ts
- Contract addresses verified: VaultRegistry `9cc1...22ac`, AliasRegistry `645e...51c7`
- **Bugs found and fixed during build testing:**
  1. `indexerPublicDataProvider()` called with 1 arg instead of required 2 (missing `wsIndexerUrl`) — fixed across 4 service files
  2. Vite `__vitePreload` wrapper crashes MV3 service worker (`document`/`window` undefined) — fixed with DOM shim in `background.ts`
  3. `import()` disallowed in MV3 service workers — converted all dynamic imports to static in background-reachable code

### AC 2: Wallet Flow
- Lace wallet detected and connected on preprod
- Master password creation successful
- Extension redirected to credentials list (0 credentials)

### AC 3: Credential Flow
- **Local credential CRUD**: ✅ Created credential via extension popup (service name auto-detected from Reddit)
- **Autofill**: ✅ Clicked AliasVault icon in Reddit login field → credential appeared → autofill worked
- **Blockchain upload**: ❌ `TypeError: Cannot read properties of undefined (reading 'setContractAddress')` — `findDeployedContract()` requires 5 `MidnightProviders` but only 2 are provided
- **Inline credential creation** (from autofill popup on website): ⚠️ Service name detected but other fields not editable — user had to create via extension popup instead
- **Note**: After unlocking vault, must refresh the page for content script to update lock state

### AC 4–8: On-Chain Operations
All blocked by the missing provider gap in `findDeployedContract()`. The providers needed:
- `privateStateProvider` — needs in-memory implementation (no LevelDB in service worker)
- `zkConfigProvider` — needs fetch-based ZK config provider
- `walletProvider` — needs Lace wallet bridge (API lives in page MAIN world, not background)

### AC 9: Console Audit

**Errors:**
1. `VaultSyncError: No vault registration found on-chain` — expected for new user, not a bug
2. `TypeError: Cannot read properties of undefined (reading 'setContractAddress')` — missing providers (see AC 3)
3. `Error parsing current URL: TypeError: Failed to construct 'URL': Invalid URL` — edge case when content script passes empty URL

**Non-blocking warnings:**
- `Unchecked runtime.lastError: The page keeping the extension port is moved into back/forward cache` — standard Chrome bfcache warning
- `Cannot read properties of undefined (reading 'fingerprint')` — Lace wallet detection on pages without wallet

## Issues Found

| # | Severity | Description | Root Cause | Fix |
|---|----------|-------------|------------|-----|
| 1 | HIGH | `indexerPublicDataProvider` called with 1 arg | Missing `wsIndexerUrl` param | Fixed in Story 6.5 |
| 2 | HIGH | `document is not defined` in service worker | Vite `__vitePreload` wrapper | Fixed: DOM shim in `background.ts` |
| 3 | HIGH | `import() is disallowed` in service worker | Dynamic imports in background code | Fixed: converted to static imports |
| 4 | HIGH | `setContractAddress` undefined | Missing 3 of 5 providers for `findDeployedContract` | **Needs new story** |
| 5 | LOW | Inline credential form fields not editable | Content script popup rendering issue | Pre-existing, needs investigation |
| 6 | LOW | "AliasVault is locked" banner persists after unlock | Content script caches lock state | Workaround: refresh page |

## Files Modified in Story 6.5

1. `src/entrypoints/background.ts` — DOM shim + static MidnightContractService import
2. `src/services/MidnightContractService.ts` — static imports for all Midnight SDK packages
3. `src/entrypoints/background/VaultMessageHandler.ts` — static CredentialMatcher import
4. `src/services/AliasService.ts` — added wsIndexerUrl to indexerPublicDataProvider calls
5. `src/services/BackupWalletService.ts` — added wsIndexerUrl parameter and calls
6. `src/services/RecoveryClaimService.ts` — added wsIndexerUrl parameter and calls
7. `src/entrypoints/popup/config/networkConfig.ts` — added VITE_PROOF_SERVER_URL env override
8. `.env.example` — new file documenting required env variables
