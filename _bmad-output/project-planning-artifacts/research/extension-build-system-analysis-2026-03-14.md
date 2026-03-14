# Extension Build System Analysis

**Date:** 2026-03-14
**Author:** Winston (Architect agent), prompted by Story 6.2 build failures
**Status:** Active — changes being implemented in Story 6.2

---

## Problem Statement

The browser extension (`apps/browser-extension/`) has never had a working production build (`wxt build`). It was only ever run via `wxt dev` (Vite dev server), which lazily resolves imports and never exercises the Midnight SDK code paths without an actual blockchain connection. Story 6.2 (multi-network config) surfaced this when AC #8/#9 required successful builds.

## Root Cause Analysis

Two independent resolution failures prevent `wxt build -b chrome` from completing:

### Problem A: Dist Copy External References

Shared workspace packages (`vault-sync`, `vault-types`, `models`, etc.) are built with `tsup`, which by default externalizes all `dependencies` listed in their `package.json`. The extension uses **pre-built dist copies** of these packages at `src/utils/dist/shared/` (per Rule 24 — extension is outside the pnpm workspace). These copies contain unresolved `import`/`require()` statements:

| Unresolved specifier | Source file | Origin |
|---|---|---|
| `@aliasvault/vault-types` | `dist/shared/vault-sync/index.mjs` | workspace dep, externalized by tsup |
| `@aliasvault/models/vault` | `dist/shared/vault-sync/index.mjs` | workspace dep, externalized by tsup |
| `secrets.js-34r7h` | `dist/shared/vault-sync/index.js` (CJS) | npm dep, externalized by tsup |
| `@aliasvault/contract` | `dist/shared/vault-sync/index.mjs` | workspace dep, externalized by tsup |

**Why tsup externalizes these:** `tsup` reads `package.json` `dependencies` and automatically marks them as external. `vault-sync/tsup.config.ts` explicitly externalizes `@aliasvault/contract` and `@aliasvault/ipfs-service`, but `vault-types`, `models`, and `secrets.js-34r7h` are auto-externalized because they're in `dependencies`.

### Problem B: Midnight SDK Dynamic Imports

Service files (`MidnightContractService`, `AliasService`, `BackupWalletService`, `RecoveryClaimService`) use `await import('@midnight-ntwrk/*')` and `await import('@aliasvault/contract')`. These packages:

- Are NOT in the extension's `package.json`
- Are NOT in root `node_modules`
- Exist only in `packages/blockchain/node_modules/.ignored/@midnight-ntwrk/` (pnpm internal storage)
- Have ambient type declarations in `src/types/externals.d.ts`

Rollup promotes the unresolved import warning to an error, blocking the build.

## Approaches Evaluated

### 1. `rollupOptions.external` (rejected)

Externalizing the unresolved packages tells Rollup to leave the `import()` statements as-is in the output. This makes the build succeed but **breaks at runtime** — a Chrome extension service worker has no Node.js module resolution. Dynamic `import()` must resolve to bundled chunks within the extension's output directory.

### 2. `resolve.alias` with directory paths (rejected)

Mapping `@midnight-ntwrk` to the `.ignored/` directory via `resolve.alias`:
- Vite treats aliases as file paths, not package directories
- No `package.json` entry point resolution occurs
- Cascading: each resolved package has its own deps that also need aliasing

### 3. Custom `resolveId` plugin (rejected — fragile)

A Rollup plugin intercepting bare specifiers and mapping to entry files:
- Works for direct deps but transitive deps cascade
- Relies on pnpm's `.ignored/` directory structure (internal, not a public API)
- Breaks on SDK version bumps (paths change)
- Not how the build toolchain is designed to work

### 4. Add `apps/*` to workspace + proper deps (selected)

Add the extension to the pnpm workspace and declare the midnight SDK packages as proper `devDependencies`. This:
- Uses pnpm's module resolution as designed
- Handles the entire transitive dependency graph
- Survives SDK version bumps (just change version numbers)
- Makes CI/CD reliable (`pnpm install && pnpm run build:chrome` just works)

## Selected Solution: Workspace Integration

### Change 1: `pnpm-workspace.yaml`

```yaml
packages:
  - "packages/*"
  - "packages/blockchain/*"
  - "shared/*"
  - "services/*"
  - "apps/*"          # NEW — enables dep resolution for extension builds
```

**Impact:** `pnpm install` will now process `apps/browser-extension/package.json` and `apps/mobile-app/package.json` as workspace members. The mobile app has its own deps (Expo) but no conflicting packages.

### Change 2: `apps/browser-extension/package.json` — New devDependencies

```json
"devDependencies": {
  "@midnight-ntwrk/compact-js": "2.4.0",
  "@midnight-ntwrk/midnight-js-contracts": "3.1.0",
  "@midnight-ntwrk/midnight-js-http-client-proof-provider": "3.1.0",
  "@midnight-ntwrk/midnight-js-indexer-public-data-provider": "3.1.0",
  "@aliasvault/contract": "workspace:*",
  "@aliasvault/vault-sync": "workspace:*"
}
```

**Why devDependencies:** These are needed only at build time for Rollup to resolve and bundle. At runtime, they become code-split chunks in the extension output.

**Version pinning:** Matches `packages/blockchain/package.json` versions from Story 6.1 SDK alignment.

### Change 3: `shared/vault-sync/tsup.config.ts` — Bundle workspace deps

```ts
noExternal: ['@aliasvault/vault-types', '@aliasvault/models', 'secrets.js-34r7h']
```

This makes the vault-sync dist output self-contained for these deps. `@aliasvault/contract` stays external (it's resolved via the new workspace dep above).

After changing, rebuild vault-sync and re-copy dist to `apps/browser-extension/src/utils/dist/shared/vault-sync/`.

### Change 4: `wxt.config.ts` — Revert to clean

Remove any `resolve.alias`, `rollupOptions.external`, or custom plugins added during debugging. Standard Node module resolution handles everything.

### Change 5: `pnpm install`

Run after changes 1-2 to set up the dependency graph.

### Change 6: Rule 24 Update

Update `_bmad-output/project-context.md` Rule 24 to reflect:
- `apps/*` IS now in `pnpm-workspace.yaml` (for dependency resolution)
- The dist-copy pattern for shared packages still applies (avoids circular deps at the TSX import level)
- Extension can now use `workspace:*` for packages it dynamically imports

## Bundle Size Risk

`@aliasvault/contract` dist is 53MB (48MB ZK proving keys in `managed/*/keys/`). The midnight SDK packages total 29MB. If Rollup pulls in the proving keys, the extension becomes unusable.

**Mitigation:** Rollup's tree-shaking should exclude the keys because:
- The extension only imports type/ledger functions and `pureCircuits`, not provers
- The `managed/*/keys/*.prover` files are loaded by path in the CLI, not via `import`
- If tree-shaking fails, add `managed/*/keys/*` to `rollupOptions.external` as a targeted fix

**Verification:** After build, check `dist/` total size. Expected: <10MB (extension code + SDK client code). If >20MB, proving keys leaked in.

## Files Referenced

| File | Role |
|---|---|
| `pnpm-workspace.yaml` | Workspace member declaration |
| `apps/browser-extension/package.json` | Extension dependencies |
| `apps/browser-extension/wxt.config.ts` | Vite/Rollup build config |
| `apps/browser-extension/src/types/externals.d.ts` | Ambient type declarations for runtime packages |
| `shared/vault-sync/tsup.config.ts` | Vault-sync build config (externals control) |
| `shared/vault-sync/package.json` | Vault-sync dependencies (auto-externalized by tsup) |
| `packages/blockchain/package.json` | Midnight SDK version source of truth |
| `packages/blockchain/node_modules/.ignored/@midnight-ntwrk/` | Pnpm internal storage for SDK packages |
| `packages/blockchain/contract/dist/` | Compiled contract output (53MB, includes proving keys) |
| `_bmad-output/project-context.md` Rule 24 | Workspace topology documentation |

## Downstream Impact

- **Story 6.4 (preprod contract deployment):** Benefits directly — build works with `VITE_MIDNIGHT_NETWORK=preprod`
- **Story 6.5 (E2E smoke test):** Requires working build — this unblocks it
- **CI/CD:** `pnpm install` time may increase slightly due to midnight SDK packages being resolved for the extension workspace. Not significant.
- **Mobile app:** Adding `apps/*` to workspace makes pnpm process `apps/mobile-app/package.json`. Verify Expo deps don't conflict (they shouldn't — completely different package set).
