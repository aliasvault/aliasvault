# Story 6.3: AliasRegistry Deployment Script

Status: review

## Story

As a developer,
I want a headless deployment script for the AliasRegistry contract,
so that I can deploy it to local/preview/preprod with a single command.

## Acceptance Criteria

1. `packages/blockchain/cli/src/deploy-alias-registry.ts` created — clones `deploy-vault-registry.ts` pattern
2. Supports `--network=local|preview|preprod`, `--seed=<hex>`, `--dry-run` flags (reuse `parseDeployArgs()` from `deploy-utils.ts`)
3. Derives deterministic secret key with domain separator `':aliasvault:alias-registry:owner'` (distinct from VaultRegistry's `':aliasvault:vault-registry:owner'`)
4. Uses AliasRegistry contract from `@aliasvault/contract` (imports `AliasRegistry`, `aliasRegistryWitnesses`, `createAliasRegistryPrivateState`)
5. After deployment: updates `shared/config/contracts.ts` AliasRegistry address block
6. `updateContractsConfig()` in `deploy-utils.ts` generalized to accept a contract name parameter (or separate `updateAliasRegistryConfig()` added)
7. `alias-registry-types.ts` created with `AliasRegistryProviders`, `AliasRegistryCircuits`, `DeployedAliasRegistryContract` types
8. `alias-registry-api.ts` created with `deployAliasRegistry()` and `getAliasRegistryLedgerState()` functions
9. `package.json` scripts added: `deploy-alias-local`, `deploy-alias-preview`, `deploy-alias-preprod`
10. `pnpm run deploy-alias-local` deploys successfully against local Docker chain
11. Output raw contract address on final line (CI/CD compatible)

## Tasks / Subtasks

- [x] Task 1: Create `alias-registry-types.ts` (AC: #7)
  - [x] 1.1 Create `packages/blockchain/cli/src/alias-registry-types.ts` — clone `vault-registry-types.ts` structure
  - [x] 1.2 Define `AliasRegistryCircuits = ImpureCircuitId<AliasRegistry.Contract<AliasRegistryPrivateState>>`
  - [x] 1.3 Define `AliasRegistryPrivateStateId = 'aliasRegistryPrivateState'`
  - [x] 1.4 Define `AliasRegistryProviders = MidnightProviders<AliasRegistryCircuits, typeof AliasRegistryPrivateStateId, AliasRegistryPrivateState>`
  - [x] 1.5 Define `DeployedAliasRegistryContract = DeployedContract<AliasRegistryContract> | FoundContract<AliasRegistryContract>`
  - [x] 1.6 Re-export `AliasRegistryPrivateState` from `@aliasvault/contract`

- [x] Task 2: Create `alias-registry-api.ts` (AC: #4, #8)
  - [x] 2.1 Create `packages/blockchain/cli/src/alias-registry-api.ts` — follow `vault-registry-api.ts` pattern
  - [x] 2.2 Set `aliasRegistryZkConfigPath = path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'alias-registry')`
  - [x] 2.3 Build compiled contract: `CompiledContract.make('alias-registry', AliasRegistry.Contract).pipe(CompiledContract.withWitnesses(aliasRegistryWitnesses), CompiledContract.withCompiledFileAssets(aliasRegistryZkConfigPath))`
  - [x] 2.4 Implement `deployAliasRegistry(providers, secretKey)`:
    - Call `deployContract(providers, { compiledContract, privateStateId: 'aliasRegistryPrivateState', initialPrivateState: createAliasRegistryPrivateState(secretKey) })`
    - AliasRegistry private state only needs `secretKey` (no backupKey/relayKey — only 1 witness)
  - [x] 2.5 Implement `getAliasRegistryLedgerState(providers, contractAddress)`:
    - Query `publicDataProvider.queryContractState(contractAddress)`
    - Parse ledger with `AliasRegistry.ledger(contractState.data)`
    - Return `{ totalClaimCount, aliasOwnersEmpty, aliasOwnersSize }` (smoke-test fields)
  - [x] 2.6 Export `GENESIS_MINT_WALLET_SEED` re-export from `vault-registry-api.ts` (or import directly in deploy script) — avoid duplicating the constant
  - [x] 2.7 Add logger pattern: `let logger: Logger;` + `export const initAliasRegistryLogger = (l: Logger): void => { logger = l; };`

- [x] Task 3: Generalize `updateContractsConfig()` in `deploy-utils.ts` (AC: #6)
  - [x] 3.1 Add a `contractName` parameter: `updateContractsConfig(configPath, contractAddress, contractName = 'VaultRegistry')`
  - [x] 3.2 Change regex to use the parameter: ``new RegExp(`(${contractName}:\\s*\\{[^}]*address:\\s*')([^']*)(')`)`
  - [x] 3.3 Update error message to include `contractName`
  - [x] 3.4 Existing VaultRegistry callers unaffected (default parameter preserves backward compatibility)
  - [x] 3.5 Add `ALIAS_REGISTRY_SECRET_KEY_DOMAIN = ':aliasvault:alias-registry:owner'` constant
  - [x] 3.6 Add `deriveAliasRegistrySecretKey(seed)` that uses `ALIAS_REGISTRY_SECRET_KEY_DOMAIN` (or generalize `deriveSecretKey` to accept optional domain)

- [x] Task 4: Create `deploy-alias-registry.ts` (AC: #1, #2, #3, #5, #11)
  - [x] 4.1 Create `packages/blockchain/cli/src/deploy-alias-registry.ts` — clone `deploy-vault-registry.ts` (86 lines)
  - [x] 4.2 Change imports: `vault-registry-api` → `alias-registry-api`, `vault-registry-types` → `alias-registry-types`
  - [x] 4.3 Import `aliasRegistryZkConfigPath` from `alias-registry-api.ts`
  - [x] 4.4 Change `NodeZkConfigProvider<VaultRegistryCircuits>` → `NodeZkConfigProvider<AliasRegistryCircuits>`
  - [x] 4.5 Change `privateStateStoreName` from `'vault-registry-private-state'` to `'alias-registry-private-state'`
  - [x] 4.6 Use AliasRegistry-specific secret key derivation (domain separator `':aliasvault:alias-registry:owner'`)
  - [x] 4.7 Call `arApi.deployAliasRegistry(providers, secretKey)` instead of `vrApi.deployVaultRegistry`
  - [x] 4.8 Call `updateContractsConfig(configPath, contractAddress, 'AliasRegistry')` — pass contract name
  - [x] 4.9 Console output: `Deploying AliasRegistry to ${args.network} network...` and `AliasRegistry deployed at: ${contractAddress}`
  - [x] 4.10 Keep final-line raw address output for CI/CD

- [x] Task 5: Add package.json scripts (AC: #9)
  - [x] 5.1 Add to `packages/blockchain/cli/package.json`:
    - `"deploy-alias-local": "node --experimental-specifier-resolution=node --loader ts-node/esm src/deploy-alias-registry.ts --network=local"`
    - `"deploy-alias-preview": "node --experimental-specifier-resolution=node --loader ts-node/esm src/deploy-alias-registry.ts --network=preview"`
    - `"deploy-alias-preprod": "node --experimental-specifier-resolution=node --loader ts-node/esm src/deploy-alias-registry.ts --network=preprod"`

- [x] Task 6: Local deployment test (AC: #10, #11)
  - [x] 6.1 Ensure local Docker chain is running (`docker compose -f standalone.yml up -d` from `packages/blockchain/cli/`)
  - [x] 6.2 Run `pnpm run deploy-alias-local` from `packages/blockchain/cli/`
  - [x] 6.3 Verify deployment succeeds — contract address printed on final line
  - [x] 6.4 Verify `shared/config/contracts.ts` AliasRegistry address updated from empty string to deployed address
  - [x] 6.5 Run `pnpm run typecheck` from `packages/blockchain/cli/` — must pass

## Dev Notes

### Clone Pattern: `deploy-vault-registry.ts` Is the Exact Template

The VaultRegistry deploy script (86 lines) is the template. The AliasRegistry version differs only in:

| Aspect | VaultRegistry | AliasRegistry |
|--------|---------------|---------------|
| Private state | `secretKey`, `backupKey`, `relayKey` | `secretKey` only |
| Witnesses | 3 (`local_secret_key`, `local_backup_key`, `local_relay_key`) | 1 (`local_secret_key`) |
| Domain separator | `':aliasvault:vault-registry:owner'` | `':aliasvault:alias-registry:owner'` |
| ZK config path | `managed/vault-registry` | `managed/alias-registry` |
| Contract type | Per-user (each user deploys their own) | Singleton (deployed once globally) |
| Config regex target | `VaultRegistry:\s*\{...address:\s*'` | `AliasRegistry:\s*\{...address:\s*'` |

### AliasRegistry Private State Is Simpler

```typescript
// From packages/blockchain/contract/src/alias-registry-witnesses.ts
export type AliasRegistryPrivateState = {
  readonly secretKey: Uint8Array;  // Only field — no backupKey, no relayKey
};

export const createAliasRegistryPrivateState = (secretKey: Uint8Array) => ({ secretKey });

export const aliasRegistryWitnesses = {
  local_secret_key: ({ privateState }) => [privateState, privateState.secretKey],
};
```

VaultRegistry's `createVaultRegistryPrivateState(secretKey, backupKey?)` takes optional backupKey. AliasRegistry's `createAliasRegistryPrivateState(secretKey)` takes secretKey only. Do NOT pass extra keys.

### `updateContractsConfig()` Currently Hardcodes VaultRegistry

Current implementation in `deploy-utils.ts:51-63`:
```typescript
const pattern = /(VaultRegistry:\s*\{[^}]*address:\s*')([^']*)(')/;
```
This regex only matches the `VaultRegistry` block. Generalize to accept a `contractName` parameter so both scripts can use it. The `shared/config/contracts.ts` already has both entries:
```typescript
VaultRegistry: { address: 'd390bc9c...', version: '0.1.0' },
AliasRegistry: { address: '', version: '0.1.0' },
```

### Existing Exports from `@aliasvault/contract`

The contract package (`packages/blockchain/contract/src/index.ts`) already exports everything needed:
```typescript
export * as AliasRegistry from "./managed/alias-registry/contract/index.js";
export * from "./alias-registry-witnesses";  // createAliasRegistryPrivateState, aliasRegistryWitnesses, AliasRegistryPrivateState
```
No changes to the contract package needed.

### GENESIS_MINT_WALLET_SEED for Local Deploys

The genesis seed `'0000...0001'` is currently defined in `vault-registry-api.ts:18`. The deploy script uses it as default for `--network=local`. Import it from `vault-registry-api.ts` (don't duplicate). If you prefer decoupling, move it to `deploy-utils.ts` and import from there in both scripts.

### AliasRegistry Is a Singleton — Deploy Once

Unlike VaultRegistry (per-user), AliasRegistry is deployed once globally. All users interact with the same contract instance via `findDeployedContract` (join, not deploy). The deploy script runs once per network, then the address is committed to `shared/config/contracts.ts`.

### Compiled Contract Assets Path

The managed output lives at `packages/blockchain/contract/src/managed/alias-registry/`. Story 6.1 already recompiled all contracts with Compact 0.29.0. The `compiler/`, `contract/`, `keys/`, `zkir/` directories exist and are up to date. `CompiledContract.withCompiledFileAssets()` needs the path to this directory.

### No Post-Deploy Initialization Needed

VaultRegistry requires `registerVault()` after deployment. AliasRegistry starts with empty ledgers — no initialization circuit needed. The first `claimAlias()` call by any user auto-populates the maps.

### Project Structure Notes

- New files go in `packages/blockchain/cli/src/` (3 new files: `alias-registry-types.ts`, `alias-registry-api.ts`, `deploy-alias-registry.ts`)
- Modified files: `packages/blockchain/cli/src/deploy-utils.ts` (generalize `updateContractsConfig`), `packages/blockchain/cli/package.json` (3 new scripts)
- `shared/config/contracts.ts` will be auto-modified by the deploy script at runtime

### References

- [Source: packages/blockchain/cli/src/deploy-vault-registry.ts] — deployment template (86 lines)
- [Source: packages/blockchain/cli/src/deploy-utils.ts] — parseDeployArgs, deriveSecretKey, updateContractsConfig
- [Source: packages/blockchain/cli/src/vault-registry-api.ts] — API pattern to clone
- [Source: packages/blockchain/cli/src/vault-registry-types.ts] — types pattern to clone
- [Source: packages/blockchain/contract/src/alias-registry-witnesses.ts] — AliasRegistry private state + witnesses
- [Source: packages/blockchain/contract/src/managed/alias-registry/contract/index.d.ts] — compiled contract types
- [Source: shared/config/contracts.ts] — contract address config (AliasRegistry.address currently empty)
- [Source: _bmad-output/project-planning-artifacts/epics.md §Epic 6, Story 6.3] — epic requirements
- [Source: _bmad-output/project-context.md] — project rules and patterns

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

### Completion Notes List

- Tasks 1–5 complete: all 3 new files created, deploy-utils.ts generalized, package.json scripts added
- `pnpm run typecheck` passes clean for entire cli package (old + new files)
- Task 3.6: Generalized `deriveSecretKey(seed, domain?)` with optional domain param instead of separate function — cleaner, backward-compatible
- Task 2.6: `GENESIS_MINT_WALLET_SEED` imported from `vault-registry-api.ts` in deploy script (no duplication)
- Task 6: Local deployment successful — AliasRegistry deployed at `9ce46d1d1c92dc41f4d0a4aaf3085b715e89ee7dc0dc8f43af060849eb5f14c0`
- Fixed `standalone.yml` port mappings: dynamic → fixed (9944:9944, 6300:6300, 8088:8088) to match `StandaloneConfig`
- All 11 ACs satisfied, all tasks/subtasks marked complete

### File List

- `packages/blockchain/cli/src/alias-registry-types.ts` — NEW (Task 1)
- `packages/blockchain/cli/src/alias-registry-api.ts` — NEW (Task 2)
- `packages/blockchain/cli/src/deploy-alias-registry.ts` — NEW (Task 4)
- `packages/blockchain/cli/src/deploy-utils.ts` — MODIFIED (Task 3: generalized updateContractsConfig, deriveSecretKey; added ALIAS_REGISTRY_SECRET_KEY_DOMAIN)
- `packages/blockchain/cli/package.json` — MODIFIED (Task 5: 3 new deploy-alias-* scripts)
- `packages/blockchain/cli/standalone.yml` — MODIFIED (Task 6: fixed port mappings 9944:9944, 6300:6300, 8088:8088)
- `shared/config/contracts.ts` — MODIFIED AT RUNTIME (Task 6: AliasRegistry address set by deploy script)

### Change Log

- 2026-03-14: Story 6.3 complete. All 6 tasks implemented. AliasRegistry deployment script created following VaultRegistry pattern. deploy-utils.ts generalized for multi-contract support. Local deployment verified — contract deployed at 9ce46d1d...eb5f14c0. Fixed standalone.yml dynamic port mappings.
