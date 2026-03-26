# Story 6.5: Extension E2E Smoke Test on Preprod

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **user**,
I want **to verify the complete vault + credential + alias flow works on Midnight preprod**,
so that **we have confidence the application works on a live blockchain before mainnet launch**.

## Acceptance Criteria

1. Extension built with `VITE_MIDNIGHT_NETWORK=preprod`
2. **Wallet flow:** Lace connects to extension → sign challenge → VaultRegistry deployed for user
3. **Credential flow:** Create credential → save vault → IPFS upload succeeds → CID hash written to VaultRegistry → reload vault from blockchain succeeds
4. **Alias flow:** Generate alias → `AliasRegistry.claimAlias` succeeds → alias visible in emails tab
5. **Relay authorization:** `setMailRelay` called on user's VaultRegistry → relay commitment stored on-chain
6. **Guardian setup:** Configure guardian wallet → Shamir shares generated → IPFS upload → recovery key hash on-chain
7. **Multi-device sync:** Load vault on second browser profile → same credentials appear
8. **Conflict resolution:** Modify on device A, modify on device B, save both → merge notification appears
9. All flows complete without console errors related to network/contract connectivity

## Tasks / Subtasks

- [ ] Task 1: Environment Setup & Extension Build (AC: #1)
  - [ ] 1.1 Start local proof server: `cd packages/blockchain/cli && pnpm run preprod-ps` (Docker: `midnightntwrk/proof-server:7.0.0` on port 6300)
  - [ ] 1.2 Ensure Lace wallet browser extension installed and configured for **preprod** network
  - [ ] 1.3 Ensure Lace wallet funded with tDUST via preprod faucet (`https://faucet.preprod.midnight.network/`)
  - [ ] 1.4 Build extension: `cd apps/browser-extension && VITE_MIDNIGHT_NETWORK=preprod pnpm run build:chrome`
  - [ ] 1.5 Load unpacked extension in Chrome via `chrome://extensions` → Developer mode → Load unpacked → select `.output/chrome-mv3/`
  - [ ] 1.6 Verify extension loads without errors in `chrome://extensions` error panel

- [ ] Task 2: Wallet Connection Flow (AC: #2)
  - [ ] 2.1 Open extension popup → click "Connect Wallet"
  - [ ] 2.2 Lace popup appears → approve connection → verify extension receives wallet address
  - [ ] 2.3 Sign authentication challenge → verify signature accepted
  - [ ] 2.4 First-time user: VaultRegistry `mint` transaction fires → wait for on-chain confirmation (30-60s proof generation)
  - [ ] 2.5 Verify vault page loads with empty vault state
  - [ ] 2.6 Open DevTools console → verify no network/contract errors

- [ ] Task 3: Credential CRUD & Vault Sync (AC: #3)
  - [ ] 3.1 Navigate to credentials tab → click "Add Credential"
  - [ ] 3.2 Fill credential form (service name, username, password, URL) → save
  - [ ] 3.3 Verify credential appears in credential list
  - [ ] 3.4 Click "Save to Blockchain" → vault encrypted → IPFS upload → `updateVault` tx submitted
  - [ ] 3.5 Wait for tx confirmation → verify CID hash written to VaultRegistry (check block explorer: `https://explorer.nocy.io`)
  - [ ] 3.6 Reload extension / disconnect and reconnect wallet → vault loads from blockchain
  - [ ] 3.7 Verify all credentials match what was saved (service name, username, password, URL)

- [ ] Task 4: Alias Generation & Registration (AC: #4)
  - [ ] 4.1 Navigate to emails tab → click "Generate Alias"
  - [ ] 4.2 Alias generated (format: `<adjective>-<noun>-<digits>`) → `claimAlias` tx submitted to AliasRegistry
  - [ ] 4.3 Wait for on-chain confirmation → verify alias appears in alias list
  - [ ] 4.4 Verify alias registered on AliasRegistry (check via block explorer or indexer query)

- [ ] Task 5: Relay Authorization (AC: #5)
  - [ ] 5.1 After alias creation, extension calls `setMailRelay` on user's VaultRegistry
  - [ ] 5.2 Verify relay commitment stored on-chain (relay public key hash in contract state)
  - [ ] 5.3 Check console for successful relay authorization log

- [ ] Task 6: Guardian Setup (AC: #6)
  - [ ] 6.1 Navigate to settings → Guardian Configuration
  - [ ] 6.2 Enter guardian wallet address (use a second Lace wallet on preprod)
  - [ ] 6.3 Shamir secret sharing splits master key → verify shares generated (3-of-5 threshold or configured pattern)
  - [ ] 6.4 Encrypted guardian shares uploaded to IPFS → CID stored
  - [ ] 6.5 Recovery key hash written to VaultRegistry on-chain via `setRecoveryKeyHash`
  - [ ] 6.6 Verify guardian setup state in contract (indexed state shows recovery config)

- [ ] Task 7: Multi-Device Sync (AC: #7)
  - [ ] 7.1 Open second Chrome profile (or Firefox) with same extension build loaded
  - [ ] 7.2 Connect same Lace wallet (same seed/account)
  - [ ] 7.3 Vault loads from blockchain → decrypts → credentials list matches device A
  - [ ] 7.4 Verify all credential fields identical (no data loss in round-trip)

- [ ] Task 8: Conflict Resolution (AC: #8)
  - [ ] 8.1 On device A: edit a credential (change password) → save to blockchain
  - [ ] 8.2 On device B (stale vault): edit a different credential → attempt save
  - [ ] 8.3 Conflict detected → merge notification appears (should persist 3s per Story 4.3 fix)
  - [ ] 8.4 Verify merged vault contains both changes correctly
  - [ ] 8.5 Reload on both devices → vault state consistent

- [ ] Task 9: Console Error Audit & Test Report (AC: #9)
  - [ ] 9.1 Review DevTools console across all test flows → no errors related to network, contract, or provider connectivity
  - [ ] 9.2 Check for warnings about wrong network, missing providers, or failed indexer queries
  - [ ] 9.3 Document any non-blocking warnings with context
  - [ ] 9.4 Create test report documenting: pass/fail per AC, timing per flow, any unexpected behaviors, screenshots of key states

## Dev Notes

**This is a manual testing story — no automation code is written.** The dev agent executes each flow on the live preprod network and documents results. All tasks are test execution steps.

### Prerequisites (from Stories 6.1–6.4)

- **SDK aligned to 3.1.0** — Compact 0.29.0, midnight-js 3.1.0 (Story 6.1)
- **Multi-network config** — `VITE_MIDNIGHT_NETWORK=preprod` build support (Story 6.2)
- **Contracts deployed** — both on preprod (Story 6.4):
  - VaultRegistry: `9cc11ce659c11068a29fd124ff3e7ab50ee0ada547b08e7f4561fee0787c22ac`
  - AliasRegistry: `645ebbebf9c30ef2ff5e97cf7f161d17a9c3804bf9b5be6ae367f0ac71f451c7`
- **Addresses committed** in `shared/config/contracts.ts` with `network: 'preprod'`

### Network & Endpoints

| Endpoint | URL |
|----------|-----|
| Indexer GraphQL | `https://indexer.preprod.midnight.network/api/v3/graphql` |
| Indexer WebSocket | `wss://indexer.preprod.midnight.network/api/v3/graphql/ws` |
| Node RPC | `https://rpc.preprod.midnight.network` |
| Proof Server | `http://127.0.0.1:6300` (local Docker) |
| Block Explorer | `https://explorer.nocy.io` |
| Faucet | `https://faucet.preprod.midnight.network/` |

Configuration source: `apps/browser-extension/src/entrypoints/popup/config/networkConfig.ts` — `NETWORK_CONFIGS['preprod']`

### Proof Server Setup

```bash
# Terminal 1 — must stay running throughout all tests
cd packages/blockchain/cli
pnpm run preprod-ps
# Starts: docker run -p 6300:6300 midnightntwrk/proof-server:7.0.0 -- midnight-proof-server -v
```

Proof generation takes **30–60 seconds per transaction** on preprod. Budget accordingly.

### Lace Wallet Configuration

- Lace must be set to **preprod** network (not mainnet/preview)
- Wallet uses v4+ API: `lace.connect(networkId)` → `ConnectedAPI` (not v1 `api.enable()`)
- Connection flow uses `browser.scripting.executeScript()` with `world: 'MAIN'` to detect `window.midnight.mnLace`
- If wallet connection fails: verify Lace network matches `CURRENT_NETWORK` in extension build
- Service URIs from Lace: `{ indexerUri, indexerWsUri, proverServerUri, substrateNodeUri }` via `getConfiguration()`

### Extension Build Command

```bash
cd apps/browser-extension
VITE_MIDNIGHT_NETWORK=preprod pnpm run build:chrome
# Output: .output/chrome-mv3/
```

Build uses: `vite-plugin-wasm` + `vite-plugin-top-level-await` in `wxt.config.ts`. Background script uses `type: 'module'` for ESM service worker.

### Service Architecture (What Gets Tested)

| Service | Flow | Provider Dependencies |
|---------|------|----------------------|
| `MidnightContractService` | Vault save/load, VaultRegistry joins | indexer, proof, wallet |
| `AliasService` | claimAlias, releaseAlias | indexer, proof, wallet |
| `BackupWalletService` | Backup wallet add/remove | indexer, proof, wallet |
| `RecoveryClaimService` | Guardian recovery flow | indexer, proof, wallet |
| `VaultSyncService` | Vault save with conflict detection | IPFS (Pinata) + contract |
| `PinataBrowserProvider` | IPFS upload/download | Pinata REST API |

All services use dynamic `await import()` for Midnight SDK packages (Rule 19 — TSX cannot import `@aliasvault/contract` directly).

### Key Rules Applicable to This Story

- **Rule 11 (Simulator limitation):** `blockTimeGte()` always returns `true` in simulator — preprod uses real block times. Guardian backup wallet transfer has 72h maturation. If testing time-lock behavior, must wait real time or use pre-matured backup wallet.
- **Rule 19 (Vite import constraint):** Services use `await import()` for contract packages. If errors appear about missing modules, check dynamic import paths.
- **Rule 20 (Hex validation):** All hex values (contract addresses, keys) validated with regex before `parseInt`. If hex errors appear, check `apps/browser-extension/src/utils/hex.ts`.
- **Rule 21 (Secret key access):** Popup uses `VaultCidStore.getSecretKey()` for one-off ops. Background messages for heavy ops.
- **Rule 25 (Conflict detection):** `saveWithConflictCheck()` uses decrypt/encrypt callbacks. Merge notification holds 3s via `useRef` (Story 4.3 fix).

### Known Limitations & Expected Behaviors

1. **No network selection UI** — network is build-time config (`VITE_MIDNIGHT_NETWORK`). User cannot switch networks from the extension.
2. **Proof generation latency** — expect 30–60s per ZK transaction on preprod. UI should show loading state.
3. **72h time-lock on backup transfer** — cannot fully test backup wallet transfer maturation in a single session. Skip this sub-flow or use a pre-matured backup wallet.
4. **Lace wallet popup** — each transaction requires Lace approval popup. Cannot be automated.
5. **IPFS propagation** — Pinata uploads may take seconds to propagate. If vault reload fails immediately after save, wait and retry.
6. **Email flow not tested here** — SMTP pipeline (Mox + bridge) is Story 6.6. Alias registration is tested, but email delivery is not.

### Troubleshooting Guide

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| "Failed to connect wallet" | Lace not on preprod | Switch Lace to preprod network |
| "Proof generation failed" | Proof server not running | Start: `pnpm run preprod-ps` |
| "Contract not found" | Wrong network or address | Verify `shared/config/contracts.ts` has preprod addresses |
| "IPFS upload failed" | Pinata credentials invalid | Check `.env` for `PINATA_JWT` and `PINATA_GATEWAY` |
| "Transaction timeout" | Network congestion | Retry — preprod can be slow |
| Console: `TypeError: Cannot read property of undefined` | Dynamic import failed | Check WASM plugins in `wxt.config.ts` |
| Merge notification doesn't appear | Conflict not detected | Ensure device B has stale vault (don't reload before editing) |

### Test Report Template

Create `_bmad-output/implementation-artifacts/6-5-test-report.md` with:

```markdown
# Story 6.5 Preprod Smoke Test Report
Date: {{date}}
Extension Build: VITE_MIDNIGHT_NETWORK=preprod
Lace Wallet Version: {{version}}
Proof Server: midnightntwrk/proof-server:7.0.0

## Results Summary
| AC# | Flow | Status | Duration | Notes |
|-----|------|--------|----------|-------|
| 1 | Extension build | ⬜ | | |
| 2 | Wallet connection | ⬜ | | |
| 3 | Credential CRUD + sync | ⬜ | | |
| 4 | Alias generation | ⬜ | | |
| 5 | Relay authorization | ⬜ | | |
| 6 | Guardian setup | ⬜ | | |
| 7 | Multi-device sync | ⬜ | | |
| 8 | Conflict resolution | ⬜ | | |
| 9 | No console errors | ⬜ | | |

## Detailed Results
### AC 2: Wallet Flow
- Wallet address: {{address}}
- VaultRegistry mint tx: {{txHash}}
- Block height: {{height}}
- Duration: {{seconds}}s

### AC 3: Credential Flow
... (fill per AC)

## Issues Found
| # | Severity | Description | Steps to Reproduce |
|---|----------|-------------|-------------------|

## Console Warnings (Non-Blocking)
| Warning | Context | Impact |
|---------|---------|--------|
```

### Project Structure Notes

- Extension popup entry: `apps/browser-extension/src/entrypoints/popup/`
- Background service worker: `apps/browser-extension/src/entrypoints/background/`
- Network config: `apps/browser-extension/src/entrypoints/popup/config/networkConfig.ts`
- Contract addresses: `shared/config/contracts.ts`
- IPFS provider: `apps/browser-extension/src/services/PinataBrowserProvider.ts`
- Wallet handler: `apps/browser-extension/src/entrypoints/background/WalletMessageHandler.ts`
- Ambient type declarations: `apps/browser-extension/src/types/externals.d.ts`

### References

- [Source: _bmad-output/project-planning-artifacts/epics.md#Epic 6, Story 6.5]
- [Source: _bmad-output/architecture.md#Testing Strategy]
- [Source: _bmad-output/project-context.md#Rule 11 (Simulator limitation)]
- [Source: _bmad-output/project-context.md#Rule 19 (Vite import constraint)]
- [Source: _bmad-output/implementation-artifacts/6-4-preprod-contract-deployment.md]
- [Source: _bmad-output/implementation-artifacts/6-2-browser-extension-multi-network-config.md]
- [Source: apps/browser-extension/src/entrypoints/popup/config/networkConfig.ts]
- [Source: shared/config/contracts.ts]
- [Source: packages/blockchain/cli/proof-server.yml]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
