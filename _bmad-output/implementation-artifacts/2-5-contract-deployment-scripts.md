# Story 2.5: Contract Deployment Scripts

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want scripts to deploy VaultRegistry to Testnet and output the contract address to shared config,
so that CI/CD can automate contract updates and all apps consume a single source of truth for the contract address.

## Acceptance Criteria

1. `deploy.ts` script exists in `packages/blockchain/cli/` that deploys VaultRegistry to a target network (local, preview, preprod)
2. Script outputs the deployed contract address to `shared/config/contracts.ts` automatically
3. README in `packages/blockchain/` documents how to run the deployment script

## Tasks / Subtasks

- [x] Task 1: Create `deploy-vault-registry.ts` deployment script (AC: #1)
  - [x] 1.1: Create `cli/src/deploy-vault-registry.ts` — headless (non-interactive) VaultRegistry deploy
  - [x] 1.2: Accept `--network` flag (`local`, `preview`, `preprod`) defaulting to `local`
  - [x] 1.3: Accept optional `--seed` flag for wallet seed (required for preview/preprod, defaults to genesis for local)
  - [x] 1.4: Reuse existing `deployVaultRegistry()` from `vault-registry-api.ts` and provider setup from `api.ts`
  - [x] 1.5: Generate a deterministic `secretKey` via SHA-256 of wallet seed (reproducible across runs) — **not** `crypto.randomBytes()` (which would create a new owner identity each time)
  - [x] 1.6: Print deployed contract address to stdout on success; exit code 0 on success, 1 on failure

- [x] Task 2: Write deployed address to `shared/config/contracts.ts` (AC: #2)
  - [x] 2.1: After successful deploy, read `shared/config/contracts.ts`
  - [x] 2.2: Update `VaultRegistry.address` field with the new contract address string
  - [x] 2.3: Use a regex or AST-based replacement — do NOT rewrite the entire file (preserve comments, formatting)
  - [x] 2.4: Log the update to stdout: `Updated shared/config/contracts.ts → VaultRegistry.address = "<address>"`
  - [x] 2.5: If `--dry-run` flag is set, print the address but skip the file write

- [x] Task 3: Add npm scripts to `packages/blockchain/package.json` and `cli/package.json` (AC: #1)
  - [x] 3.1: Add `deploy-local` script: runs deploy with `--network local`
  - [x] 3.2: Add `deploy-preview` script: runs deploy with `--network preview`
  - [x] 3.3: Add `deploy-preprod` script: runs deploy with `--network preprod`

- [x] Task 4: Update README with deployment instructions (AC: #3)
  - [x] 4.1: Add "Deployment" section to `packages/blockchain/README.md`
  - [x] 4.2: Document prerequisites per network (local: Docker running, preview/preprod: proof server + seed phrase)
  - [x] 4.3: Document the `--seed`, `--network`, `--dry-run` flags
  - [x] 4.4: Document the post-deploy contract address flow (shared/config → browser extension → mobile app)

- [x] Task 5: Unit tests for deployment utilities (AC: #1, #2)
  - [x] 5.1: Test `updateContractsConfig()` — reads/writes `shared/config/contracts.ts` correctly
  - [x] 5.2: Test regex replacement preserves file structure and comments
  - [x] 5.3: Test deterministic secret key derivation from seed
  - [x] 5.4: Test CLI argument parsing (`--network`, `--seed`, `--dry-run`)

- [x] Task 6: Verify end-to-end on local network
  - [x] 6.1: Run `npm run deploy-local` against running local Midnight network
  - [x] 6.2: Confirm `shared/config/contracts.ts` updated with valid hex address
  - [x] 6.3: Confirm browser extension can import the updated address (build succeeds)

## Dev Notes

### What EXISTS (reuse — DO NOT reinvent)

| Component | Location | What to Reuse |
|-----------|----------|---------------|
| `deployVaultRegistry()` | `cli/src/vault-registry-api.ts` | Full deploy logic with compiled contract + logger |
| `joinVaultRegistry()` | `cli/src/vault-registry-api.ts` | Join existing contract (for verify step) |
| Network configs | `cli/src/config.ts` | `StandaloneConfig`, `PreviewConfig`, `PreprodConfig` with URLs + networkId |
| Wallet setup | `cli/src/api.ts` | `buildWalletAndWaitForFunds()`, `createWalletAndMidnightProvider()` |
| Provider setup | `cli/src/tui_vault_registry.ts` lines 46-61 | Full provider wiring pattern for VaultRegistry |
| Shared config placeholder | `shared/config/contracts.ts` | `CONTRACTS.VaultRegistry.address` — currently empty string |
| VaultRegistry types | `cli/src/vault-registry-types.ts` | `VaultRegistryProviders`, `DeployedVaultRegistryContract` |

### Architecture Constraints

- **ADR-004 (Contract Address Management):** ALL apps import from `shared/config/contracts.ts`. The deploy script MUST update this file. No hardcoded addresses.
- **Midnight SDK is TypeScript-only (Rule 8):** Deploy script runs via `ts-node` or compiled JS, same as existing TUI scripts.
- **Windows compatibility:** Use `fileURLToPath(import.meta.url)` for `__dirname` equivalent (already established in `config.ts`). Path construction must work on both Windows and WSL.
- **Proof server required:** Preview/preprod need a local proof server running (`http://127.0.0.1:6300`). Local network has its own proof server in Docker.
- **Secret key determinism:** The deploy script must produce the same `secretKey` for the same wallet seed, so re-deploying or joining from another script yields the same owner identity. Use `SHA-256(seed + "aliasvault:vault-registry:owner")` as the derivation.

### Critical Implementation Details

**1. File update strategy for `shared/config/contracts.ts`:**
```typescript
// Use regex to replace ONLY the address field value
const content = fs.readFileSync(configPath, 'utf-8');
const updated = content.replace(
  /(VaultRegistry:\s*\{[^}]*address:\s*')([^']*)(')/,
  `$1${contractAddress}$3`
);
fs.writeFileSync(configPath, updated, 'utf-8');
```

**2. Deterministic secret key derivation:**
```typescript
import crypto from 'node:crypto';
// Deterministic: same seed always produces same secretKey
const secretKey = crypto.createHash('sha256')
  .update(seed + ':aliasvault:vault-registry:owner')
  .digest();
```

**3. CLI argument parsing pattern (keep it simple — no external deps):**
```typescript
const args = process.argv.slice(2);
const network = args.find(a => a.startsWith('--network='))?.split('=')[1] ?? 'local';
const seed = args.find(a => a.startsWith('--seed='))?.split('=')[1];
const dryRun = args.includes('--dry-run');
```

**4. Provider setup (copy from tui_vault_registry.ts, NOT from scratch):**
```typescript
import { StandaloneConfig, PreviewConfig, PreprodConfig } from './config.js';
const ConfigClass = { local: StandaloneConfig, preview: PreviewConfig, preprod: PreprodConfig }[network];
const config = new ConfigClass();
// ... same provider wiring as tui_vault_registry.ts lines 46-61
```

### Previous Story Learnings (2.1–2.4)

- **`vault-registry-api.ts` already has `deployVaultRegistry()`:** Takes providers + secretKey, returns `DeployedVaultRegistryContract`. Do NOT duplicate.
- **`tui_vault_registry.ts` has full provider wiring:** Lines 46-61 show exact pattern for creating VaultRegistryProviders. Copy this, don't reinvent.
- **Windows path issues (Story 1.1):** `config.ts` uses `fileURLToPath()` — already handles Windows. New scripts must use `import.meta.url` too.
- **`safeTimestamp()` in config.ts:** Replaces colons in ISO timestamps for Windows filenames. Already handled.
- **Dynamic imports in browser extension:** `MidnightContractService.ts` dynamically imports SDK. The CLI uses static imports — keep them static in deploy script.
- **Compiled contract artifacts:** Located at `contract/src/managed/vault-registry/`. The `vaultRegistryZkConfigPath` in `vault-registry-api.ts` already resolves this.
- **Genesis seed for local:** `'0000000000000000000000000000000000000000000000000000000000000001'` — used by all TUI scripts for standalone mode.

### Anti-Patterns to Avoid

- **DO NOT** use `crypto.randomBytes()` for secretKey in deploy script — makes owner non-deterministic
- **DO NOT** hardcode contract addresses anywhere — always write to `shared/config/contracts.ts`
- **DO NOT** add new npm dependencies for CLI arg parsing (no `commander`, `yargs`) — keep it simple like existing scripts
- **DO NOT** create a new config class — reuse `StandaloneConfig`/`PreviewConfig`/`PreprodConfig` from `config.ts`
- **DO NOT** rewrite `shared/config/contracts.ts` from scratch — use targeted regex replacement to preserve structure
- **DO NOT** use `require()` — the blockchain package is ESM (`"type": "module"`)

### Testing Strategy

- **Unit tests** for `updateContractsConfig()` utility (file read/write with regex):
  - `cli/src/test/deploy-utils.test.ts` — mock `fs` or use temp directory
  - Test cases: empty address → fills, existing address → overwrites, malformed file → error
- **Integration test** on local network (manual — same as `tui_vault_registry.ts`):
  - Run `npm run deploy-local`, verify stdout output, verify file update
- **Existing contract tests** (13 + 6) must still pass — this story doesn't touch contract code

### Project Structure Notes

```
packages/blockchain/
├── cli/src/
│   ├── deploy-vault-registry.ts    # NEW: headless deployment script
│   ├── deploy-utils.ts             # NEW: shared deploy utilities (config update, secret key derivation)
│   ├── vault-registry-api.ts       # EXISTS: deployVaultRegistry(), joinVaultRegistry()
│   ├── config.ts                   # EXISTS: StandaloneConfig, PreviewConfig, PreprodConfig
│   ├── api.ts                      # EXISTS: wallet setup, provider creation
│   ├── test/
│   │   └── deploy-utils.test.ts    # NEW: unit tests for deploy utilities
│   └── ...
├── README.md                       # MODIFIED: add Deployment section
shared/config/
└── contracts.ts                    # MODIFIED: address field populated after deploy
```

### References

- [Source: shared/config/contracts.ts] — ADR-004 contract address placeholder
- [Source: packages/blockchain/cli/src/vault-registry-api.ts] — existing `deployVaultRegistry()` function
- [Source: packages/blockchain/cli/src/config.ts] — network configurations (local, preview, preprod)
- [Source: packages/blockchain/cli/src/tui_vault_registry.ts:46-61] — VaultRegistry provider wiring pattern
- [Source: _bmad-output/project-context.md#Rule 4] — Contract Address Management (ADR-004)
- [Source: _bmad-output/project-context.md#Rule 9] — Compact Contract Ownership Pattern
- [Source: _bmad-output/architecture.md#Section 1] — Midnight Smart Contract State Model
- [Source: epics.md#Story 2.5] — Epic acceptance criteria

## Dev Agent Record

### Agent Model Used
Claude (Cascade) — 2026-02-08

### Debug Log References
- E2E launch initially blocked by missing `rxjs` explicit dependency — pnpm strict hoisting doesn't expose transitive deps. Added `rxjs: ^7.8.2` to `packages/blockchain/package.json`. Script now launches correctly on Windows Node v24, builds wallet, syncs, and deploys successfully.
- Full E2E verified: deployed contract `e386083d04bdf1820466c8e1ac395ef06ecc2688fc4816e175bef51cb537f868`, `shared/config/contracts.ts` auto-updated with address.
- Review Round 1: 0 Critical, 5 Medium, 3 Low — all fixes applied (see Post-Review Notes).

### Completion Notes List
- Created `deploy-utils.ts` with 3 pure utility functions: `deriveSecretKey()`, `parseDeployArgs()`, `updateContractsConfig()`
- Created `deploy-vault-registry.ts` — headless deploy script reusing `deployVaultRegistry()` from `vault-registry-api.ts` and provider wiring from `tui_vault_registry.ts`
- Deterministic secret key uses `SHA-256(seed + ':aliasvault:vault-registry:owner')` — same seed always produces same owner identity
- Config file update uses targeted regex `/(VaultRegistry:\s*\{[^}]*address:\s*')([^']*)(')/` — preserves all comments and formatting
- Added `deploy-local`, `deploy-preview`, `deploy-preprod` npm scripts to both `cli/package.json` and root `packages/blockchain/package.json`
- README Deployment section documents prerequisites per network, all flags, and post-deploy flow
- 16 new unit tests covering all 3 utility functions + 6 existing vault-registry-api tests + 16 contract tests = 38 total passing
- Midnight MCP syntax reference validated — contract patterns (persistentCommit, disclose, pragma >=0.20) confirmed correct
- No Compact contract changes in this story — purely TypeScript deployment tooling
- **Post-Review Refactoring**: Extracted shared constants `GENESIS_MINT_WALLET_SEED` and `vaultRegistryZkConfigPath` to `vault-registry-api.ts` to eliminate DRY violations (previously duplicated across 2-3 files)
- **Post-Review Fix**: CLI arg parsing now handles `=` in values via `.split('=').slice(1).join('=')`

### File List

**New files:**
- `packages/blockchain/cli/src/deploy-vault-registry.ts` — headless deployment script
- `packages/blockchain/cli/src/deploy-utils.ts` — shared deploy utilities (deriveSecretKey, parseDeployArgs, updateContractsConfig)
- `packages/blockchain/cli/src/test/deploy-utils.test.ts` — 16 unit tests

**Modified files:**
- `packages/blockchain/package.json` — add `deploy-local`, `deploy-preview`, `deploy-preprod` scripts; add `rxjs` explicit dep
- `packages/blockchain/package-lock.json` — auto-updated from `rxjs` dep addition
- `packages/blockchain/cli/package.json` — add deploy npm scripts
- `packages/blockchain/cli/src/vault-registry-api.ts` — export `GENESIS_MINT_WALLET_SEED` and `vaultRegistryZkConfigPath` constants
- `packages/blockchain/cli/src/tui_vault_registry.ts` — import shared constants instead of duplicating
- `packages/blockchain/README.md` — add Deployment section with prerequisites, usage, flags, post-deploy flow; update structure diagram
- `shared/config/contracts.ts` — address populated by deploy script (runtime effect)

## Change Log
- 2026-02-08: Story 2.5 implemented — deploy-vault-registry.ts script with deterministic secret key, shared config update, npm scripts, README docs, 16 unit tests
- 2026-02-08: Review Round 1 fixes applied — README structure diagram, npm script usage docs, shared constants extraction, CLI arg parsing edge case fix, package-lock.json documented
