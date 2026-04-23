# 7.0 — Local DevNet Research & MCP Tool Verification

Status: done (research)
Date: 2026-04-18
Author: Claude (tool-verified, not assumed)

## Purpose

Prerequisite research for Epic 7 (local DevNet for iteration + real E2E tests, per user pivot 2026-04-18). Answers three gating questions before we prescribe any MCP-tool-driven workflow in Rule 18 or in migration stories:

1. Do the Midnight MCP tools produce useful output for our specific version-upgrade paths?
2. Can the regular Lace wallet (post-Midnight-Preview deprecation) connect to local DevNet endpoints?
3. What extension-test architecture should we use for local DevNet E2E?

## 1. MCP tool verification (against our actual versions)

All tool calls executed 2026-04-18. Raw output in MCP call log; summaries below.

### ✅ `mcp__midnight__midnight-check-breaking-changes` — USEFUL

Called for both upgrade paths we care about:

- **`compact` 0.29.0 → latest (0.5.1 devtools / 0.30.0 compiler):** Returns concrete breaking-change list including the exact rename that Story 6.5b Task 7.5 warned about: `NativePoint` → `JubjubPoint`, and `NativePointX`/`NativePointY` → `nativePointX`/`nativePointY`. Also flags Issue #220 (zkir SIGILL on ARM Docker) which is a known environment issue.
- **`midnight-js` 3.0.0 → v4.0.4:** Returns 6 concrete breaking changes: `LevelPrivateStateProvider` must accept `walletProvider` or `passwordProvider`; `submitTx` now returns `Promise<TransactionId>`; `WalletProvider.balanceTx` signature change (returns `FinalizedTransaction`); new unproven-transaction workflow; `ZswapOffer` empty offers no longer allowed; `networkId` changed from enum to string. Matches Story 6.5b Dev Notes closely.

**Caveats:**
- Compares `currentVersion` to *latest*, not to an arbitrary target. If your upgrade only spans part of that range, manually trim changes that apply above your actual target.
- Output formatting can be noisy (stray `"15.0"` line, fragmented `*What changed**:` markers) — treat as a starting checklist, not polished prose.

**Verdict:** Adopt as first-call for SDK/compactc upgrades. Add to Rule 18.

### ⚠️ `mcp__midnight__midnight-get-migration-guide` — UNRELIABLE for precise version targets

Called twice:
- `compact` 0.29.0 → 0.30.0 (precise target): returns `breakingChangesCount: 0, deprecationsCount: 0, newFeaturesCount: 0, migrationDifficulty: "Easy - No breaking changes"`. **This is demonstrably wrong** — the `NativePoint`→`JubjubPoint` rename lives in this range.
- `midnight-js` 3.0.0 → 4.0.4 (precise target): same empty response. Also wrong — Story 6.5b's entire existence proves v3→v4 has breaking changes.
- `compact` 0.29.0 → (unspecified, defaults to latest): returns partial data (1 issue).

**Verdict:** Do **not** adopt as a gating step. Do **not** add to Rule 18 as "REQUIRED before upgrades." The tool likely requires a specific MIGRATION_GUIDE.md file to exist in the target-version tag to return non-empty output, and for our paths that file is absent.

### ⚠️ `mcp__midnight__midnight-review-contract` — UNAVAILABLE in this environment

Called with a trivial counter contract. Response: `"Review failed: Error: Sampling not supported by this client - use Claude Desktop for this feature"`, `samplingAvailable: false`.

**Verdict:** Cannot be used from Claude Code. Rubric scoring against VaultRegistry / AliasRegistry / GuardianRecovery must be done **manually** (P1 #6 in the plan). Do not add to Rule 18 as a rubric tool.

### ❌ `mcp__midnight__midnight-check-version` — WRONG TOOL (corrected in plan)

Description confirms it checks whether the MCP package itself is up-to-date on npm. It does not compare our project deps against upstream. Initial plan wording "weekly check to prevent drift between extension and portal" was wrong — plan now corrected.

### ✅ `mcp__midnight__midnight-get-version-info` — USEFUL (replaces `check-version` for drift monitoring)

- `midnight-js`: latest `v4.0.4` published 2026-04-01. Our extension is on 4.0.4 ✅; portal + smtp-bridge on 3.0.0; CLI on 3.1.0.
- `compact`: latest devtools `compact-v0.5.1` (2026-03-25). Compiler `compactc-v0.30.0` released 2026-03-17 — **confirms Story 6.5b Task 7.1 target is still current stable.** (Note: devtools and compiler have separate version tracks.)

**Verdict:** Adopt as the drift-check tool. Add to Rule 18.

### ✅ `mcp__midnight__midnight-fetch-docs`, `midnight-list-examples`, `midnight-search-docs`, `midnight-search-typescript`, `midnight-search-compact`, `midnight-get-file` — USEFUL

All exercised during the plan-review research pass. Content is live and matches the published docs. Already documented in Rule 18 (or being added).

## 2. Lace wallet + local DevNet — UNVERIFIED

Current state of knowledge (from MCP search during plan review):

- `NetworkId.Undeployed = 0` is a first-class SDK concept (Compact-runtime / Ledger / OnchainRuntime `NetworkId` enum).
- The midnight-js testkit supports `MN_TEST_ENVIRONMENT=undeployed` and spins up a local Docker stack via `testcontainers` with ports node:9944, indexer:8088, proof:6300 — **these match AliasVault's existing `packages/blockchain/cli/standalone.yml` setup.**
- Midnight installation docs mention: *"To use a local proof-server with the Lace Midnight wallet, go to **Settings » Midnight** and select `Local (http://localhost:6300)`."* This confirms **local proof-server** support in current Lace.
- **UNVERIFIED:** whether current regular Lace UI also allows configuring a local **node endpoint** (`http://localhost:9944`) or exposes an "Undeployed" network option in the network selector. The older Lace Midnight Preview wallet did expose this; post-deprecation Lace behavior requires manual testing of the actual installed extension.

**Decision (to unblock Epic 7 without waiting for manual Lace test):**

Start with **testkit / programmatic wallet** for headless E2E. This path is proven: `packages/blockchain/cli/src/tui_vault_registry.ts` already uses `GENESIS_MINT_WALLET_SEED` with `api.buildWalletAndWaitForFunds(config, seed)` against `StandaloneConfig`. Extension E2E tests should replicate this pattern in a Vitest `beforeAll` global setup.

Lace-local UI testing is a **follow-up story**, not a prerequisite. Defer until:
- Headless E2E is green against local DevNet
- Someone runs the new regular Lace UI manually and documents whether "Undeployed" is selectable + whether custom node URLs are accepted

Browser-UI tests via Playwright are similarly deferred until the Lace question is answered. Interim option if Lace turns out NOT to support local: a dev-mode `LaceWalletProxy` stub gated by an explicit env flag that signs with a test key. That is a *contingency plan*, not the default path.

## 3. Extension-test architecture recommendation

Based on items 1 and 2:

1. **New `pnpm run test:e2e` script** in `apps/browser-extension` running Vitest with a dedicated config file (`vitest.e2e.config.ts`) excluded from the default `pnpm run test` run.
2. **Global setup** that assumes `packages/blockchain/cli/standalone.yml` is already running — user runs `pnpm --filter @aliasvault/blockchain-cli standalone` first (or a root `pnpm devnet:up` wrapper once added).
3. **Test wallet:** build with `GENESIS_MINT_WALLET_SEED` via the existing `buildWalletAndWaitForFunds` helper in `packages/blockchain/cli/src/api.ts` (or export it as a shared test util).
4. **Contract deploys:** call `pnpm run deploy-local` before the test suite, OR deploy in a `beforeAll` hook. Whichever is chosen must NOT overwrite preprod addresses in `shared/config/contracts.ts` — that's the open design decision tracked in Task #9.
5. **Circuit coverage:** measure what `packages/blockchain/cli/src/test/commons.ts` + `pnpm run test-api` already cover before writing new tests. Only ADD what's missing, specifically exercising the browser-extension service layer (`MidnightContractService`, `AliasService`, `BackupWalletService`, `RecoveryClaimService`) against real providers.
6. **Do NOT delete** existing mocked unit tests — the E2E harness is additive.

## 4. Rule 18 delta (recommendation for Task #5)

Replace the existing "Use MCP tools" bullet with a tool-by-tool breakdown. Only adopt tools that were verified above:

**Verified and recommended:**
- `mcp__midnight__midnight-fetch-docs` — live-fetch from docs.midnight.network; preferable to stale local copies
- `mcp__midnight__midnight-list-examples` — 12+ reference projects catalogued; satisfies the "≥8 references" protocol
- `mcp__midnight__midnight-search-docs` / `midnight-search-typescript` / `midnight-search-compact` — existing, already in Rule 18
- `mcp__midnight__midnight-get-file` / `midnight-get-repo-context` — existing, already in Rule 18
- `mcp__midnight__midnight-check-breaking-changes` — **first-call** before any `@midnight-ntwrk/*` upgrade or `compactc` update. Caveat: compares to latest, manually trim if your target is older.
- `mcp__midnight__midnight-get-version-info` — drift monitoring; run monthly or before any Epic start

**Deliberately NOT adopted (and why):**
- `mcp__midnight__midnight-get-migration-guide` — returns empty for precise `fromVersion`/`toVersion` pairs on our paths; do not rely on.
- `mcp__midnight__midnight-review-contract` — requires client sampling; unavailable in Claude Code. Use manual scoring instead.
- `mcp__midnight__midnight-check-version` — checks the MCP package itself, not our deps. Use `midnight-get-version-info` for dep drift.

**Cost of not following this rule:** Story 6.5b was rolled back from review after adversarial code review found `coinPublicKey` bug, missing tests, and AC #3 gaps. `midnight-check-breaking-changes` would have surfaced the `networkId` enum→string change and the `balanceTx` signature change upfront, likely preventing the rollback.

## Open items carried forward

- **Task #5** (Rule 18 update) — unblocked by this research; ready to execute
- **Task #6** (rubric self-assessment) — must be done manually; no MCP tool path
- **Task #2** (extend CLI standalone) — ready after Task #7 (CLI v4 migration) + Task #9 (contracts.ts design)
- **Lace-local manual test** — new follow-up needed; not on critical path for Epic 7
