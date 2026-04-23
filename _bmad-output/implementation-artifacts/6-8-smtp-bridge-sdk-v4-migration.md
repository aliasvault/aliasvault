# Story 6.8: Midnight SDK v3→v4 Migration (SMTP Bridge)

Status: backlog

<!-- Surfaced 2026-04-18 during plan review. Not originally scoped in Epic 6; added because services/smtp-bridge/package.json was discovered to be on `@midnight-ntwrk/midnight-js-contracts@3.0.0` alongside guardian-portal. -->
<!-- Eligible for parallel execution with Story 6.7 (Guardian Portal SDK v4) since the migration patterns are identical. -->

## Story

As an **AliasVault engineer running the SMTP bridge service on current Midnight infrastructure**,
I want **`services/smtp-bridge` migrated from `@midnight-ntwrk/*` v3.0.0/v3.1.0 to v4.0.4**,
so that **the bridge's `notifyNewMail` relay circuit calls remain compatible with the preprod/mainnet ledger-v8 infrastructure, and so that all AliasVault code paths speak the same SDK version during local DevNet E2E**.

## Acceptance Criteria

1. All `@midnight-ntwrk/midnight-js-*` packages in `services/smtp-bridge/package.json` pinned to `4.0.4` (currently mixed 3.0.0 and 3.1.0 — see pkg lines 22-29).
2. `compact-js` bumped `2.4.0` → `2.5.0`; `compact-runtime` bumped `0.14.0` → `0.15.0` (matches extension + CLI post-6.5c).
3. `ledger-v7@7.0.0` removed; `ledger-v8@8.0.3` added.
4. Breaking changes (per `midnight-check-breaking-changes --repo=midnight-js --currentVersion=3.0.0`) addressed in source:
   - `LevelPrivateStateProvider` now requires `walletProvider` or `passwordProvider` — verify `services/smtp-bridge/src/midnight/*.ts` provider wiring (see existing `services/guardian-portal/src/services/midnightService.ts` for pattern)
   - `submitTx` → `Promise<TransactionId>` — await pattern consistent
   - `WalletProvider.balanceTx` → `FinalizedTransaction` return — relay flow must handle
   - `networkId` type enum → string literal
   - `ZswapOffer` empty-offer rejection, new unproven-transaction workflow — audit if applicable
5. Any indexer URLs the bridge hits updated to `/api/v4/graphql`.
6. `pnpm --filter @aliasvault/smtp-bridge build` and `test` pass after migration.
7. If the bridge has health check / smoke test endpoints, verify they still return 200 against a local or preprod node.

## Tasks / Subtasks

- [ ] Task 1: Package bumps
  - [ ] 1.1 Edit `services/smtp-bridge/package.json` lines 19-32 — align all `@midnight-ntwrk/*` to v4-compatible matrix (mirror `apps/browser-extension/package.json:53-62`)
  - [ ] 1.2 Remove `ledger-v7`, add `ledger-v8@8.0.3`
  - [ ] 1.3 `pnpm install`; confirm no peer conflicts

- [ ] Task 2: Source code fixups
  - [ ] 2.1 `grep -r "@midnight-ntwrk/ledger-v7" services/smtp-bridge/src` — replace with `ledger-v8`
  - [ ] 2.2 `grep -r "NetworkId\." services/smtp-bridge/src` — replace enum usage with string literals
  - [ ] 2.3 Audit `submitTx` / `balanceTx` / `LevelPrivateStateProvider` call sites per AC #4
  - [ ] 2.4 Update any indexer URL strings hard-coded in bridge source to `/api/v4/graphql`

- [ ] Task 3: Test + build verification
  - [ ] 3.1 `pnpm --filter @aliasvault/smtp-bridge typecheck` clean
  - [ ] 3.2 `pnpm --filter @aliasvault/smtp-bridge test` passes
  - [ ] 3.3 `pnpm --filter @aliasvault/smtp-bridge build` clean
  - [ ] 3.4 Health endpoint smoke test if applicable

- [ ] Task 4: Update `sprint-status.yaml` to `done` + MEMORY.md note

## Dev Notes

### Why
SMTP bridge speaks to VaultRegistry contract via relay circuit (`notifyNewMail`, `setMailRelay`). Contract was redeployed at preprod on v4-compatible SDK (Story 6.4). Bridge v3 client may fail or return incorrect data against v4 ledger infra.

### Reuse from 6.5b and 6.5c
Same patterns — skip any Lace-specific UI work (bridge is headless).

### Shared scope with 6.7
Guardian portal and smtp-bridge both use the same Node.js stack + same provider pattern (6-provider configuration + `findDeployedContract`). Consider executing in one combined sprint to minimize duplicated migration effort. If done together, share a single `VaultRegistry private state` pattern audit and a single ledger-v7→v8 swap test.
