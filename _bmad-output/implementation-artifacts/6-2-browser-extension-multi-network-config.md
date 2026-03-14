# Story 6.2: Browser Extension Multi-Network Configuration

Status: review

## Story

As a user,
I want the browser extension to connect to preprod (and eventually mainnet),
so that I can use AliasVault on the live Midnight network.

## Acceptance Criteria

1. `NETWORK_CONFIGS` map ported from `services/guardian-portal/src/config/networkConfig.ts` to `apps/browser-extension/src/entrypoints/popup/config/networkConfig.ts` with all 5 networks (undeployed, preprod, preview, qanet, mainnet)
2. `getNetworkConfig(networkId?)` function added — same pattern as guardian portal, throws on unknown network
3. All hardcoded `INDEXER_URL`, `NODE_URL`, `PROOF_SERVER_URL` individual exports replaced — consumers use `getNetworkConfig()` instead
4. `CURRENT_NETWORK` resolved from `import.meta.env.VITE_MIDNIGHT_NETWORK` at build time, falling back to `'undeployed'`
5. `MidnightContractService` uses `getNetworkConfig()` for indexer/proof-server URLs (no more direct constant imports)
6. Lace wallet connection passes correct `networkId` — verify `WalletMessageHandler.ts` line 19 (`const WALLET_NETWORK_ID: string = CURRENT_NETWORK`) resolves to `'preprod'` when built with `VITE_MIDNIGHT_NETWORK=preprod`
7. No `wxt.config.ts` changes needed for env var passthrough — WXT already passes `VITE_*` env vars natively (proven by existing `VITE_PINATA_JWT` usage in `VaultMessageHandler.ts`). Note: `wxt.config.ts` was modified separately for WASM plugin support (emergent build-system fix scope)
8. Extension builds successfully with `VITE_MIDNIGHT_NETWORK=preprod`
9. Extension builds successfully with `VITE_MIDNIGHT_NETWORK=undeployed` (default, backwards compatible)
10. Existing unit tests pass; new tests cover `getNetworkConfig()` valid/invalid network, env-var resolution

## Tasks / Subtasks

- [x] Task 1: Rewrite `networkConfig.ts` with `NETWORK_CONFIGS` map (AC: #1, #2, #3, #4)
  - [x] 1.1 Add `NetworkConfig` interface: `{ networkId, indexerUrl, wsIndexerUrl, nodeUrl, proofServerUrl }`
  - [x] 1.2 Add `NETWORK_CONFIGS: Record<MidnightNetworkId, NetworkConfig>` map — copy endpoint URLs from guardian portal's `networkConfig.ts`
  - [x] 1.3 Replace `export const CURRENT_NETWORK: MidnightNetworkId = 'undeployed'` with env-var resolution: `(import.meta.env.VITE_MIDNIGHT_NETWORK as MidnightNetworkId) || 'undeployed'`
  - [x] 1.4 Add `getNetworkConfig(networkId?: string): NetworkConfig` — defaults to `CURRENT_NETWORK`, throws on unknown ID
  - [x] 1.5 Remove individual `INDEXER_URL`, `NODE_URL`, `PROOF_SERVER_URL` exports — all access through `getNetworkConfig()`. `NODE_URL` has zero importers (delete immediately). `INDEXER_URL` and `PROOF_SERVER_URL` must only be removed AFTER Tasks 3-6 update all 4 consumer service files.
  - [x] 1.6 Keep exporting `CURRENT_NETWORK` and `MidnightNetworkId` type (used by WalletMessageHandler, WalletService, explorerConfig)

- [x] Task 2: Verify env var passthrough (AC: #7)
  - [x] 2.1 No `wxt.config.ts` changes needed — WXT already passes `VITE_*` env vars through Vite natively (proven by `VITE_PINATA_JWT` usage in `VaultMessageHandler.ts` lines 589-590). Verify `import.meta.env.VITE_MIDNIGHT_NETWORK` resolves correctly in the built output.
  - [x] 2.2 If verification fails (unlikely), fall back to explicit `define` in wxt.config.ts vite block: `define: { 'import.meta.env.VITE_MIDNIGHT_NETWORK': JSON.stringify(process.env.VITE_MIDNIGHT_NETWORK || 'undeployed') }`

- [x] Task 3: Update `MidnightContractService` (AC: #5)
  - [x] 3.1 Replace `import { INDEXER_URL, PROOF_SERVER_URL } from '../entrypoints/popup/config/networkConfig'` with `import { getNetworkConfig } from '../entrypoints/popup/config/networkConfig'`
  - [x] 3.2 In the constructor/default config, use `getNetworkConfig().indexerUrl` and `getNetworkConfig().proofServerUrl` instead of `INDEXER_URL` / `PROOF_SERVER_URL`
  - [x] 3.3 Ensure `MidnightContractConfig` interface still supports overrides (optional `indexerUrl`, `proofServerUrl` params override config defaults)

- [x] Task 4: Update `AliasService` (AC: #3)
  - [x] 4.1 Replace `import { INDEXER_URL, PROOF_SERVER_URL }` with `import { getNetworkConfig }`
  - [x] 4.2 Replace direct `INDEXER_URL` / `PROOF_SERVER_URL` usages with `getNetworkConfig().indexerUrl` / `.proofServerUrl`
  - [x] 4.3 Three replacement sites: line ~53 (`PROOF_SERVER_URL` in `joinAliasRegistry`), line ~54 (`INDEXER_URL` in `joinAliasRegistry`), line ~100 (`INDEXER_URL` in `checkAliasAvailable`)

- [x] Task 5: Update `BackupWalletService` (AC: #3)
  - [x] 5.1 Replace `import { INDEXER_URL, PROOF_SERVER_URL }` with `import { getNetworkConfig }`
  - [x] 5.2 Update default parameter values in all 4 functions: `getBackupWalletStatus` (1 param), `addBackupWallet` (2 params), `removeBackupWallet` (2 params), `executeBackupTransfer` (2 params) — total 7 default param replacements from `INDEXER_URL`/`PROOF_SERVER_URL` to `getNetworkConfig().indexerUrl`/`.proofServerUrl`

- [x] Task 6: Update `RecoveryClaimService` (AC: #3)
  - [x] 6.1 Replace `import { INDEXER_URL, PROOF_SERVER_URL }` with `import { getNetworkConfig }`
  - [x] 6.2 Update default parameter values: `fetchOnChainRecoveryKeyHash` (line ~42 — indexerUrl), `callClaimRecoveryOnChain` (lines ~132-133 — indexerUrl + proofServerUrl), `getRecoveryState` (line ~177 — indexerUrl)

- [x] Task 7: Verify wallet + explorer integration (AC: #6)
  - [x] 7.1 `WalletMessageHandler.ts` imports `CURRENT_NETWORK` — no change needed (still exported from networkConfig)
  - [x] 7.2 `WalletService.ts` imports `CURRENT_NETWORK` — no change needed
  - [x] 7.3 `explorerConfig.ts` imports `CURRENT_NETWORK` — no code change needed. Note: explorerConfig has no `qanet` entry; `getExplorerConfig()` returns `null` for qanet — this is correct (no explorer for qanet)
  - [x] 7.4 Confirm Lace `connect(networkId)` still receives the right value when `VITE_MIDNIGHT_NETWORK=preprod`
  - [x] 7.5 `background.ts` and `VaultMessageHandler.ts` instantiate `MidnightContractService()` with no args — constructor defaults now use `getNetworkConfig()` internally. No caller changes needed.

- [x] Task 8: Update tests (AC: #10)
  - [x] 8.1 Rewrite `networkConfig.test.ts` — test `getNetworkConfig()` returns correct config for each network, throws on invalid ID, defaults to `CURRENT_NETWORK`. Note: `import.meta.env` values are statically replaced by Vite at build time, so module-level `CURRENT_NETWORK` captures the value at import time. Test `getNetworkConfig('preprod')` directly rather than trying to mock `import.meta.env`.
  - [x] 8.2 Verify existing service tests still pass (they mock at service level, not at networkConfig level)

- [x] Task 9: Build verification (AC: #8, #9)
  - [x] 9.1 Run `VITE_MIDNIGHT_NETWORK=undeployed pnpm run build:chrome` in `apps/browser-extension/` — must succeed
  - [x] 9.2 Run `VITE_MIDNIGHT_NETWORK=preprod pnpm run build:chrome` in `apps/browser-extension/` — must succeed
  - [x] 9.3 Run `pnpm run build:chrome` (no env var) — must succeed with default `undeployed`
  - [x] 9.4 Run `pnpm run test` in `apps/browser-extension/` — all tests pass (8 pre-existing FormFiller birthdate timezone failures excluded)

## Dev Notes

### Source Pattern — Guardian Portal `networkConfig.ts`

Port directly from `services/guardian-portal/src/config/networkConfig.ts`. The exact endpoint URLs for all 5 networks are:

```
undeployed: http://localhost:8088/api/v3/graphql | ws://localhost:8088/api/v3/graphql/ws | http://localhost:9944 | http://localhost:6300
preprod:    https://indexer.preprod.midnight.network/api/v3/graphql | wss://indexer.preprod.midnight.network/api/v3/graphql/ws | https://rpc.preprod.midnight.network | https://proof.preprod.midnight.network
preview:    https://indexer.preview.midnight.network/api/v3/graphql | wss://indexer.preview.midnight.network/api/v3/graphql/ws | https://rpc.preview.midnight.network | https://proof.preview.midnight.network
qanet:      https://indexer.qanet.midnight.network/api/v3/graphql | wss://indexer.qanet.midnight.network/api/v3/graphql/ws | https://rpc.qanet.midnight.network | https://proof.qanet.midnight.network
mainnet:    https://indexer.midnight.network/api/v3/graphql | wss://indexer.midnight.network/api/v3/graphql/ws | https://rpc.midnight.network | https://proof.midnight.network
```

### Files That Import From `networkConfig.ts` (8 total)

| File | Import | Change Required |
|------|--------|-----------------|
| `src/services/MidnightContractService.ts` | `INDEXER_URL`, `PROOF_SERVER_URL` | Replace with `getNetworkConfig()` |
| `src/services/BackupWalletService.ts` | `INDEXER_URL`, `PROOF_SERVER_URL` | Replace with `getNetworkConfig()` |
| `src/services/AliasService.ts` | `INDEXER_URL`, `PROOF_SERVER_URL` | Replace with `getNetworkConfig()` |
| `src/services/RecoveryClaimService.ts` | `INDEXER_URL`, `PROOF_SERVER_URL` | Replace with `getNetworkConfig()` |
| `src/entrypoints/background/WalletMessageHandler.ts` | `CURRENT_NETWORK` | No change (still exported) |
| `src/entrypoints/popup/services/WalletService.ts` | `CURRENT_NETWORK` | No change (still exported) |
| `src/entrypoints/popup/config/explorerConfig.ts` | `CURRENT_NETWORK` | No change (still exported) |
| `src/entrypoints/popup/config/__tests__/networkConfig.test.ts` | `CURRENT_NETWORK`, `MidnightNetworkId` | Rewrite tests |

### WXT + Vite Env Var Strategy

**Confirmed: Vite native passthrough works.** `VaultMessageHandler.ts` already uses `import.meta.env.VITE_PINATA_JWT` and `import.meta.env.VITE_PINATA_GATEWAY` (lines 589-590), proving WXT passes `VITE_*` env vars through Vite natively. No `define` config needed in `wxt.config.ts`. Just set `VITE_MIDNIGHT_NETWORK` at build time and reference `import.meta.env.VITE_MIDNIGHT_NETWORK` in code.

**Verified non-importers:** `InboxService.ts` and `EmailAlarmHandler.ts` (new in Story 5.7) do NOT import from networkConfig — they receive dependencies via constructor injection / callback parameters.

### wsIndexerUrl and nodeUrl — Not Used Yet

No current extension service imports `wsIndexerUrl` or `NODE_URL`. These fields are included in `NetworkConfig` for future use (WebSocket subscriptions, direct node RPC). Do NOT search for or create consumers in this story.

### Contract Addresses Are NOT Per-Network Yet

`shared/config/contracts.ts` has a single `CONTRACTS` map (not per-network). This is intentional for now — the same addresses are used until Story 6.4 deploys to preprod. The epic note says: "Consider a `CONTRACTS_BY_NETWORK` map later." Do NOT add per-network addresses in this story.

### Proof Server URL Is Moot for User Transactions

Lace wallet provides its own proving provider for user-signed transactions. `PROOF_SERVER_URL` is only used by `MidnightContractService` for server-side operations (read-only indexer queries don't need it). Include it in the config for completeness — server-side and background operations may need it.

### CSP Considerations

`wxt.config.ts` sets CSP: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`. This does NOT restrict `connect-src`, so HTTPS connections to `*.midnight.network` work. No CSP changes needed.

### Previous Story Intelligence (6.1)

Story 6.1 (SDK Alignment) is in `review` status. Key learnings:
- SDK bumped to midnight-js 3.1.0, Docker node 0.21.0, indexer 3.1.0
- All contracts recompiled with Compact 0.29.0
- Pre-existing type errors exist in extension (React bigint→ReactNode, Vite plugin types) — NOT caused by SDK bump, do not fix in this story
- `wallet-sdk-address-format` and `wallet-sdk-hd` are at 3.0.1 (not 3.1.0 — 3.1.0 not published)
- `shared/config/contracts.ts` has local deployment address `d390bc9c...` — will change after preprod deploy in 6.4

### Project Structure Notes

- `apps/*` added to `pnpm-workspace.yaml` for dependency resolution (build fix — see research doc)
- `networkConfig.ts` lives at `src/entrypoints/popup/config/` — keep it there (all imports use this path or `@/entrypoints/popup/config/`)
- Service files at `src/services/` use relative imports like `'../entrypoints/popup/config/networkConfig'`
- Ambient declarations in `src/types/externals.d.ts` — no changes needed for this story
- Dist-copy pattern for shared packages still applies (Rule 24 updated)

### References

- [Source: services/guardian-portal/src/config/networkConfig.ts] — pattern to port
- [Source: services/guardian-portal/src/config/__tests__/networkConfig.test.ts] — test pattern
- [Source: apps/browser-extension/src/entrypoints/popup/config/networkConfig.ts] — file to rewrite
- [Source: apps/browser-extension/wxt.config.ts] — env var passthrough
- [Source: shared/config/contracts.ts] — contract addresses (not per-network yet)
- [Source: _bmad-output/project-planning-artifacts/research/testnet-deployment-research-2026-03-10.md §3.2] — research basis
- [Source: _bmad-output/project-context.md Rule 19] — Vite import constraint (TSX can't import @aliasvault/contract directly)
- [Source: _bmad-output/project-planning-artifacts/research/extension-build-system-analysis-2026-03-14.md] — build system analysis

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-03-11 | Story created | Epic 6 — testnet deployment prep |
| 2026-03-14 | Tasks 1-9 implemented | Multi-network config + build system fix |
| 2026-03-14 | Build system fix: workspace integration | Extension build never worked; added apps/* to workspace, midnight SDK devDeps, WASM plugin, ESM background |
| 2026-03-14 | vault-sync dist rebuilt with noExternal | Bundled vault-types, models, secrets.js-34r7h into dist copy |
| 2026-03-14 | React version pinned to 19.0.0 | Workspace change caused react-dom version mismatch |
| 2026-03-14 | Code review fixes: H1, M1, M2, L1, L2 | H1: error message used wrong var (both extension + guardian portal). M1: removed false .d.ts entries from file list. M2: consolidated redundant getNetworkConfig() calls. L1: clarified AC#7 wording. L2: corrected "pinned" to "caret-range" |

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- Build system analysis: `_bmad-output/project-planning-artifacts/research/extension-build-system-analysis-2026-03-14.md`
- Architect consultation (Winston) during implementation for build system fix

### Completion Notes List

- Rewrote networkConfig.ts with NETWORK_CONFIGS map, env-var CURRENT_NETWORK, getNetworkConfig() function
- Updated all 4 consumer services (MidnightContractService, AliasService, BackupWalletService, RecoveryClaimService) to use getNetworkConfig()
- Verified wallet/explorer integration still works with CURRENT_NETWORK export
- Wrote 7 new tests for getNetworkConfig() — all pass
- Fixed pre-existing build system issue: added apps/* to pnpm-workspace.yaml, midnight SDK devDeps, vite-plugin-wasm + vite-plugin-top-level-await, ESM background module type
- Rebuilt vault-sync with noExternal for workspace deps — eliminated dist copy external refs
- Added caret-range react/react-dom ^19.0.0 to extension package.json to fix version mismatch from workspace change (lockfile pins exact version)
- All 3 build configs pass: undeployed (26.78MB), preprod (26.79MB), no-env-var default (26.78MB)
- 344 tests pass, 8 pre-existing FormFiller birthdate timezone failures unrelated to changes

### File List

- `pnpm-workspace.yaml` — added `apps/*`
- `pnpm-lock.yaml` — updated from pnpm install
- `apps/browser-extension/package.json` — added midnight SDK + workspace devDeps, pinned react 19.0.0, added vite-plugin-wasm + vite-plugin-top-level-await
- `apps/browser-extension/wxt.config.ts` — added wasm() + topLevelAwait() plugins
- `apps/browser-extension/src/entrypoints/popup/config/networkConfig.ts` — rewritten with NETWORK_CONFIGS map, getNetworkConfig(), env-var CURRENT_NETWORK
- `apps/browser-extension/src/entrypoints/popup/config/__tests__/networkConfig.test.ts` — rewritten with 7 tests
- `apps/browser-extension/src/entrypoints/background.ts` — added `type: 'module'` to defineBackground
- `apps/browser-extension/src/services/MidnightContractService.ts` — import INDEXER_URL/PROOF_SERVER_URL → getNetworkConfig()
- `apps/browser-extension/src/services/AliasService.ts` — import INDEXER_URL/PROOF_SERVER_URL → getNetworkConfig()
- `apps/browser-extension/src/services/BackupWalletService.ts` — import INDEXER_URL/PROOF_SERVER_URL → getNetworkConfig()
- `apps/browser-extension/src/services/RecoveryClaimService.ts` — import INDEXER_URL/PROOF_SERVER_URL → getNetworkConfig()
- `apps/browser-extension/src/utils/dist/shared/vault-sync/index.mjs` — rebuilt with bundled deps
- `apps/browser-extension/src/utils/dist/shared/vault-sync/index.js` — rebuilt with bundled deps
- `shared/vault-sync/tsup.config.ts` — added noExternal for vault-types, models, secrets.js-34r7h
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 6-2 status: in-progress → review
- `_bmad-output/project-planning-artifacts/research/extension-build-system-analysis-2026-03-14.md` — new research doc
