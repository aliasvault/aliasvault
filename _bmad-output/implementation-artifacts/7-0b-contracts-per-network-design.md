# 7.0b — Per-network Contract Address Storage: Design Decision

Status: proposed (pending implementation alongside Story 6.5c / Epic 7)
Date: 2026-04-18
Context: `shared/config/contracts.ts` holds exactly one `{ address, version, network }` tuple per contract. The ADR-004 "single source of truth" rule is sound at the *project* level but collides with Epic 7's local-DevNet direction because `pnpm run deploy-local` writes via `updateContractsConfig` in `packages/blockchain/cli/src/deploy-utils.ts:54-83` and currently **overwrites** whatever network entry existed. The code does `console.warn` when replacing a different-network address (lines 62-65) but still writes through at line 74.

## Problem statement

When Epic 7 E2E tests run `deploy-local` to materialize a fresh VaultRegistry on the local standalone stack, the preprod address `9cc1...22ac` gets clobbered. That breaks later operations (preprod reads, block explorer links, production URL generation) until someone manually restores the preprod address. Running tests should be **idempotent and non-destructive** with respect to the preprod tuple.

## Constraints

- ADR-004 / Rule 4: contract addresses must not be string literals scattered across app code — single import point
- Local deploys generate fresh addresses every test run (no persistence between runs is expected or desirable)
- Preprod address `9cc1...22ac` (VaultRegistry) and `645e...51c7` (AliasRegistry) are stable and must survive local test runs
- Existing call sites import from `shared/config/contracts.ts` as a static constant
- `updateContractsConfig` is also used by preprod deploy (`pnpm run deploy-preprod`) — must preserve write-through semantics for that path

## Options considered

### Option A — Per-network map in `contracts.ts` (recommended)

```typescript
// shared/config/contracts.ts
export type NetworkKey = 'local' | 'preview' | 'preprod' | 'mainnet';

export interface ContractAddressEntry {
  address: string;  // may be '' if not deployed to this network yet
  version: string;
}

export interface ContractConfig {
  byNetwork: Partial<Record<NetworkKey, ContractAddressEntry>>;
}

export const CONTRACTS: Record<string, ContractConfig> = {
  VaultRegistry: {
    byNetwork: {
      preprod: { address: '9cc11ce659c11068a29fd124ff3e7ab50ee0ada547b08e7f4561fee0787c22ac', version: '0.1.0' },
      local:   { address: '',                                                                   version: '0.1.0' },
    },
  },
  AliasRegistry: {
    byNetwork: {
      preprod: { address: '645ebbebf9c30ef2ff5e97cf7f161d17a9c3804bf9b5be6ae367f0ac71f451c7', version: '0.1.0' },
      local:   { address: '',                                                                   version: '0.1.0' },
    },
  },
};

export function getContractAddress(name: string, network: NetworkKey): string {
  const entry = CONTRACTS[name]?.byNetwork[network];
  if (!entry?.address) {
    throw new Error(`No ${name} address configured for network "${network}"`);
  }
  return entry.address;
}
```

`deploy-utils.ts` `updateContractsConfig` rewrites ONLY `CONTRACTS.${name}.byNetwork.${network}.address`, leaving other networks intact. Implementation updates the regex to target the nested path.

**Pros:**
- Preprod and local addresses coexist in one file (single source of truth preserved)
- Type-safe lookup via `getContractAddress(name, network)`
- `deploy-local` and `deploy-preprod` are non-destructive to each other
- Clear extension path to `preview` and eventually `mainnet`
- Null-safe: `''` address + `throw` if caller asks for a network without deploy

**Cons:**
- Breaking change to the type shape — every call site that destructures `CONTRACTS.VaultRegistry.address` must migrate to `getContractAddress('VaultRegistry', network)` or `CONTRACTS.VaultRegistry.byNetwork[network]?.address`
- Requires rewriting `updateContractsConfig` regex logic (currently uses flat `address` field with lookahead)

### Option B — Separate file for local addresses

`shared/config/contracts.ts` remains unchanged (preprod-only). Add `shared/config/contracts.local.ts` (gitignored) that `deploy-local` writes, tests import.

**Pros:**
- Minimal churn to existing production readers
- Clear separation of test data from production config

**Cons:**
- Gitignored file is a footgun — breaks anyone running `pnpm test:e2e` fresh without first running `deploy-local`
- Two files for callers to track; easy to import the wrong one
- Violates the spirit of ADR-004 ("single source of truth") even if the letter survives

### Option C — Runtime env-var override

`contracts.ts` unchanged; add `VAULT_REGISTRY_ADDRESS_LOCAL` env var support in provider/test setup code that overrides the imported constant when present.

**Pros:**
- Zero schema change

**Cons:**
- Test ergonomics: every test run needs to capture and re-plumb the fresh address via environment
- Deploy output → env export → test input chain is brittle
- Still requires changes to reader code (env check wrappers), just in more places

### Option D — `--dry-run` always for local + address captured in test state

`deploy-local --dry-run` returns a contract address via stdout, test harness captures it in-memory for the duration of the test suite, never writes to disk.

**Pros:**
- Zero schema change
- Keeps `contracts.ts` immutable across test runs

**Cons:**
- `--dry-run` in `deploy-vault-registry.ts:67-74` currently skips the whole "write config" step — but the deploy itself is real (`withStatus('Deploying...')` still runs). So the contract IS deployed, just not recorded. That's what we want for tests.
- Extension code reads `contracts.ts` statically — for the extension to use a fresh local address, it'd need runtime injection
- Works for CLI-driven integration tests, awkward for extension-side E2E that reads a static constant at build time

## Recommendation

**Adopt Option A** (per-network map). Rationale:
- Preserves ADR-004 single-source-of-truth intent
- Addresses the core problem without tests needing process-level plumbing
- Extension code can read from a typed lookup with a network parameter (it already knows its network from `VITE_MIDNIGHT_NETWORK`)
- Migration cost is bounded: one schema change + one `deploy-utils.ts` rewrite + N call-site updates (grep for `CONTRACTS.VaultRegistry.address` and `CONTRACTS.AliasRegistry.address`)

**Interim fallback:** if Option A implementation gets stuck, use Option D (`--dry-run` + in-memory test state) for headless integration tests in `packages/blockchain/cli/src/test/`. Those tests already deploy contracts via `buildWalletAndWaitForFunds` + `vrApi.deployVaultRegistry` without writing `contracts.ts`.

## Migration plan

1. Land Option A schema change in `shared/config/contracts.ts` with a temporary back-compat shim:
   ```typescript
   // Back-compat export until all readers migrate
   export const CONTRACTS_FLAT = {
     VaultRegistry: CONTRACTS.VaultRegistry.byNetwork.preprod,
     AliasRegistry: CONTRACTS.AliasRegistry.byNetwork.preprod,
   };
   ```
2. Update `deploy-utils.ts:54-83` `updateContractsConfig` to target the nested path
3. Grep and migrate all readers in `apps/browser-extension/src/**` and `services/**` from `CONTRACTS.X.address` → `getContractAddress('X', CURRENT_NETWORK)`
4. Remove the back-compat shim once grep for `CONTRACTS_FLAT` returns zero hits
5. Verify `deploy-preprod` still writes to `byNetwork.preprod` correctly
6. Verify `deploy-local` writes to `byNetwork.local` without touching `byNetwork.preprod`

## Acceptance criteria for a follow-up implementation story

1. `shared/config/contracts.ts` has the `byNetwork` map structure
2. `deploy-preprod` rewrites only the `preprod` entry
3. `deploy-local` rewrites only the `local` entry
4. All existing readers import via `getContractAddress()` (or `CONTRACTS.X.byNetwork[network]?.address`)
5. A fresh `pnpm run deploy-local && git diff` shows ONLY the `VaultRegistry.byNetwork.local.address` field changed — preprod entry untouched

## Tasks (to be folded into the implementation story or directly into Task #2 of the Epic 7 plan)

- [ ] Implement Option A schema in `shared/config/contracts.ts`
- [ ] Implement `getContractAddress()` helper with typed error
- [ ] Update `packages/blockchain/cli/src/deploy-utils.ts` regex logic for nested path
- [ ] Add back-compat `CONTRACTS_FLAT` shim
- [ ] Grep + migrate all readers
- [ ] Remove back-compat shim
- [ ] Smoke test: `deploy-local` then `git diff shared/config/contracts.ts` — must not touch preprod entry
