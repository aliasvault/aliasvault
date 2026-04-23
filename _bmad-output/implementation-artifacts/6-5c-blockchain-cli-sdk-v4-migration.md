# Story 6.5c: Midnight SDK v3→v4 Migration (Blockchain CLI)

Status: ready-for-dev

<!-- Hotfix story: surfaced during 2026-04-18 plan review for Epic 7 (local DevNet E2E). -->
<!-- Explicitly deferred from Story 6.5b line 137 ("packages/blockchain/package.json ... Follow-up story required"). -->
<!-- Required prerequisite for Epic 7 real E2E tests: extension is on v4.0.4; CLI at v3.1.0 will mismatch testcontainers-based standalone stack once node/indexer/proof-server images publish v4 expectations. -->

## Story

As an **AliasVault engineer running local DevNet E2E tests**,
I want **`packages/blockchain/cli` on the same `@midnight-ntwrk/*` v4 SDK and ledger-v8 as the browser extension**,
so that **CLI-based deploy scripts and the `test-api` integration harness speak the same wire format as extension code during real E2E runs against `packages/blockchain/cli/standalone.yml`**.

## Acceptance Criteria

1. All `@midnight-ntwrk/midnight-js-*` packages in `packages/blockchain/package.json` bumped from `3.1.0` → `4.0.4`, matching the version set in `apps/browser-extension/package.json:57-62`.
2. `@midnight-ntwrk/compact-js` bumped `2.4.0` → `2.5.0`; `compact-runtime` bumped `0.14.0` → `0.15.0` (matches extension).
3. `@midnight-ntwrk/ledger-v7@7.0.0` REMOVED from dependencies; `@midnight-ntwrk/ledger-v8@8.0.3` ADDED (matches extension).
4. `@midnight-ntwrk/dapp-connector-api@4.0.1` and `@midnight-ntwrk/midnight-js-network-id@4.0.4` added only if source code references them (CLI may not need `dapp-connector-api` since there is no browser wallet in CLI flows).
5. All breaking-changes surfaced by `midnight-check-breaking-changes --repo=midnight-js --currentVersion=3.0.0` addressed in CLI source:
   - `LevelPrivateStateProvider` call sites (see `deploy-vault-registry.ts:46-49`, `deploy-alias-registry.ts`) must provide `walletProvider` or `passwordProvider` explicitly. Our current code does pass `walletProvider` — verify still correct after signature change.
   - `submitTx` call sites now return `Promise<TransactionId>` (async return type change)
   - `WalletProvider.balanceTx` signature now returns `FinalizedTransaction` — verify our wallet helper in `api.ts` matches
   - `networkId` type changed from enum to string — likely already correct since `config.ts:43` uses `setNetworkId('undeployed')` (string literal), but audit all `setNetworkId()` call sites
   - Empty `ZswapOffer` no longer allowed — audit any balance/offer construction
   - New unproven-transaction workflow — audit any low-level transaction construction (not expected in deploy scripts but check)
6. `packages/blockchain/cli/src/config.ts` indexer endpoints updated from `/api/v3/graphql` → `/api/v4/graphql` in all three config classes (`StandaloneConfig`, `PreviewConfig`, `PreprodConfig`). Matches extension networkConfig which is already on v4.
7. `pnpm --filter @aliasvault/cli build` passes with zero type errors after upgrades.
8. `pnpm --filter @aliasvault/cli test-api` passes against the `standalone.yml` stack — this is the load-bearing verification step; test-api is our existing real integration test.
9. `pnpm --filter @aliasvault/cli deploy-local` successfully deploys a fresh VaultRegistry to the local standalone stack (does not overwrite preprod addresses — see Task #9 in Epic 7 task list for `contracts.ts` per-network storage design; if that design is not yet landed, run with `--dry-run` to avoid clobbering).
10. No regressions: `pnpm --filter @aliasvault/cli deploy-preprod` still works against preprod (exercised only manually if preprod faucet is available; otherwise defer).

## Tasks / Subtasks

- [ ] Task 1: Package version bumps (AC #1-4)
  - [ ] 1.1 Edit `packages/blockchain/package.json`:
    - Bump all 7 `@midnight-ntwrk/midnight-js-*` packages `3.1.0` → `4.0.4`:
      `midnight-js-contracts`, `midnight-js-http-client-proof-provider`, `midnight-js-indexer-public-data-provider`, `midnight-js-level-private-state-provider`, `midnight-js-network-id`, `midnight-js-node-zk-config-provider`, `midnight-js-types`, `midnight-js-utils`
    - Bump `compact-js` 2.4.0 → 2.5.0; `compact-runtime` 0.14.0 → 0.15.0
    - Remove `@midnight-ntwrk/ledger-v7`; add `@midnight-ntwrk/ledger-v8@8.0.3`
    - Leave `@midnight-ntwrk/ledger` at `^4.0.0` (top-level ledger re-export, not version-suffixed)
    - Re-check wallet-sdk versions against extension — extension does not use them, but if CLI-only, leave at current `1.0.0` / `3.0.1` mix unless tests fail
  - [ ] 1.2 Run `pnpm install` from repo root; verify no peer dep conflicts; `pnpm-lock.yaml` updates
  - [ ] 1.3 Re-run `midnight-check-breaking-changes --repo=midnight-js --currentVersion=3.1.0` to confirm no new breaking items surfaced between 3.0.0 (tool's closest match) and 3.1.0

- [ ] Task 2: Source code breaking-change fixups (AC #5)
  - [ ] 2.1 Audit `packages/blockchain/cli/src/` for `setNetworkId` call sites; confirm all pass string literals (`'undeployed'` / `'preview'` / `'preprod'`) and not the removed enum
  - [ ] 2.2 Audit `levelPrivateStateProvider` call sites: `deploy-vault-registry.ts:46`, `deploy-alias-registry.ts` (equivalent), `tui_vault_registry.ts`, `api.ts`. Verify each passes `walletProvider` (we do) OR `passwordProvider` — and that the object shape still type-checks under `midnight-js-level-private-state-provider@4.0.4`
  - [ ] 2.3 Audit `submitTx` call sites — update any synchronous-style handling to `await Promise<TransactionId>` pattern
  - [ ] 2.4 Audit `WalletProvider.balanceTx` helper in `api.ts` — confirm it returns `FinalizedTransaction` shape expected by callers after signature change
  - [ ] 2.5 Ledger v7→v8 imports: grep for `@midnight-ntwrk/ledger-v7` in `packages/blockchain/cli/src/` and replace with `@midnight-ntwrk/ledger-v8`. Counter-cli v4 reference: `Transaction.deserialize(...)` and `tx.identifiers()` are the hot paths.
  - [ ] 2.6 Grep for any `NetworkId.Undeployed` / `NetworkId.TestNet` enum usage in CLI — replace with string literals if present

- [ ] Task 3: Indexer endpoint update (AC #6)
  - [ ] 3.1 Edit `packages/blockchain/cli/src/config.ts`: change `/api/v3/graphql` → `/api/v4/graphql` in `StandaloneConfig` (line 38-39), `PreviewConfig` (line 49-50), `PreprodConfig` (line 60-61)
  - [ ] 3.2 Verify `proofServer` URLs don't need version suffix change (extension uses `lace-proof-pub.*` for preprod/mainnet; CLI uses `127.0.0.1:6300` local + hardcoded `127.0.0.1:6300` for preview/preprod too — looks intentional, leave unchanged unless fails under v4)

- [ ] Task 4: Build + test verification (AC #7-10)
  - [ ] 4.1 `pnpm --filter @aliasvault/cli build` clean, zero TS errors
  - [ ] 4.2 `pnpm --filter @aliasvault/cli lint` clean
  - [ ] 4.3 `pnpm --filter @aliasvault/cli typecheck` clean
  - [ ] 4.4 `pnpm --filter @aliasvault/cli test-api` passes against `standalone.yml` stack (this is the integration test load-bearing step)
  - [ ] 4.5 `pnpm --filter @aliasvault/cli deploy-local --dry-run` produces a contract address without clobbering `shared/config/contracts.ts` (if Task #9 design not yet landed)
  - [ ] 4.6 Preprod regression test deferred — gate on manual run if faucet available

- [ ] Task 5: Document + sprint-status update
  - [ ] 5.1 Update `_bmad-output/implementation-artifacts/sprint-status.yaml` — add `6-5c-blockchain-cli-sdk-v4-migration: done` (or `review`) under Epic 6
  - [ ] 5.2 Update `MEMORY.md` note about SDK drift — mark CLI as v4 after this story closes

## Dev Notes

### Why this story exists
Story 6.5b line 137 explicitly deferred CLI updates: *"Out of scope: `packages/blockchain/package.json` (contains v3.1.0 deps + ledger-v7 for CLI tooling). Follow-up story required. The CLI is not blocking E2E extension testing."* Per the 2026-04-18 direction pivot (see `feedback_local_devnet_over_preprod.md`), CLI now IS on the critical path — its `standalone.yml` stack is the foundation of real-E2E tests for the extension.

### MCP-verified breaking changes (not assumed)
`midnight-check-breaking-changes --repo=midnight-js --currentVersion=3.0.0` output on 2026-04-18 (research log: `7-0-local-devnet-research.md`):
- LevelPrivateStateProvider — wallet/password provider requirement (#342, #346)
- `submitTx` → `Promise<TransactionId>` (#348)
- `WalletProvider.balanceTx` → `FinalizedTransaction` return
- New unproven-transaction workflow (#125)
- ZswapOffer — empty offers rejected (#125)
- `networkId` enum → string (#125)

### Scope clarification
**In scope:** `packages/blockchain/package.json` and `packages/blockchain/cli/src/**` only.
**Out of scope:** `services/guardian-portal/*` (Story 6.7), `services/smtp-bridge/*` (new story 6-8), `packages/blockchain/contract/**` (covered by Story 6.5b Task 7 compactc recompile).

### Reuse from 6.5b
Follow the patterns Story 6.5b already applied in `apps/browser-extension`:
- v4 endpoint paths in network config
- ledger-v7 → ledger-v8 import swap with same `Transaction.deserialize` shape
- `setNetworkId` with string literal
- Explicit `walletProvider` on private-state provider

### Risks
- If CLI uses wallet-SDK primitives extension doesn't, migration may surface wallet-sdk-*@1.0.0 vs 3.0.1 issues not seen in 6.5b. Watch for these during Task 4.1.
- `test-api` in `vitest.config.ts` may need longer timeouts under v4 (counter-cli v4 README hints at slower first-run due to ZK param download). If tests flake, bump timeouts, don't skip.

## Acceptance gate
All ACs green + test-api passing. Does NOT require preprod validation (preprod is a separate gate per Epic 6 roadmap).
