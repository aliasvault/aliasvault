# Story 3.7: Guardian Portal Production Build & Provider Wiring

Status: review

## Story

As a developer deploying the guardian portal,
I want `vite build` to produce a working production bundle **and** the `approveRecovery()` circuit call to work end-to-end via Lace wallet,
so that the portal can be pinned to IPFS and guardians can actually approve recovery requests on-chain.

## Background

The guardian portal (Story 3.3) was verified with `tsc -b --noEmit` during development, but has two unfinished areas:

### Issue 1: Production build fails (WASM)

```
vite v6.4.1 building for production...
[plugin vite:resolve] Module "fs" has been externalized for browser compatibility,
  imported by "@midnight-ntwrk/midnight-js-contracts/dist/index.mjs"
✗ Build failed in 13.37s
[vite:wasm-fallback] Could not load .../ledger-v7/midnight_ledger_wasm_bg.wasm
  "ESM integration proposal for Wasm" is not supported currently.
  Use vite-plugin-wasm or other community plugins to handle this.
```

Root cause: Two WASM modules (`ledger-v7@7.0.0` 10.4 MB, `onchain-runtime-v2@2.0.1` 1.4 MB) use ESM WASM proposal syntax. Vite rejects without plugins.

### Issue 2: Four MidnightProviders stubbed (Story 3.3 limitation)

In `midnightService.ts:configureGuardianProviders()`, 4 of 6 providers are stubbed with `notImplemented()` errors:
- `zkConfigProvider` — stub that throws
- `privateStateProvider` — stub that throws
- `walletProvider` — stub that throws
- `midnightProvider` — stub that throws

Only `publicDataProvider` and `proofProvider` are wired. This means **read-only** operations work (`getContractState`, `isGuardian`, `hasApproved`) but **write operations** (`approveRecovery()`) fail at runtime because proof generation requires all 6 providers.

Additionally, `walletService.ts` only extracts the address string from Lace — it discards the `ConnectedAPI` object, shielded keys, and service URIs needed to construct `walletProvider` and `midnightProvider`.

### Research: Browser provider wiring patterns across Midnight DApps

Comprehensive research across **8 projects** (3 official, 5 community) confirms a consistent pattern for all 6 providers in browser environments:

| Provider | Browser Implementation | Evidence |
|----------|----------------------|----------|
| `privateStateProvider` | `inMemoryPrivateStateProvider()` — ephemeral, Map-backed | bboard, MeshJS template, naval-battle-game use in-memory; midnight-bank, midnight-game-2 use `levelPrivateStateProvider` for persistent state |
| `publicDataProvider` | `indexerPublicDataProvider(indexerUri, indexerWsUri)` | Universal across all projects |
| `zkConfigProvider` | `new FetchZkConfigProvider(window.location.origin, fetch.bind(window))` | All browser DApps: bboard, MeshJS, midnight-bank, midnight-game-2 |
| `proofProvider` | `httpClientProofProvider(proverServerUri)` | Universal; URI from Lace `getConfiguration()` (v4) or `serviceUriConfig()` (v1) |
| `walletProvider` | `{ getCoinPublicKey(), getEncryptionPublicKey(), balanceTx() }` from Lace `ConnectedAPI` | bboard v4, MeshJS template — both construct from `connectedAPI.balanceUnsealedTransaction()` |
| `midnightProvider` | `{ submitTx() }` from Lace `ConnectedAPI` | All browser DApps — delegates to `connectedAPI.submitTransaction()` |

**Key finding:** Our portal already uses Lace v4+ API (`lace.connect(networkId)`) but only retains the address. The `ConnectedAPI` object — needed for `balanceUnsealedTransaction()`, `submitTransaction()`, `getShieldedAddresses()`, and `getConfiguration()` — is discarded. This must be fixed.

**Decision: `inMemoryPrivateStateProvider`** — The guardian portal's private state (guardian key for `approveRecovery()` witness) is already stored in localStorage via `guardianKeyService.ts`. It's injected into the contract's private state via `createGuardianRecoveryPrivateState()` at join time. The guardian doesn't need persistent private state across sessions — each `joinContract()` call re-creates it. In-memory is sufficient and avoids IndexedDB compatibility concerns. This matches bboard's approach (also uses in-memory).

**Decision: ZK circuit key serving** — `FetchZkConfigProvider` fetches prover keys and ZKIR from the app's origin as static assets. The build script must copy `keys/` and `zkir/` from the compiled contract package into `public/` so they're served by the production bundle. All browser DApps follow this pattern (bboard: `cp -r ../contract/src/managed/bboard/keys ./dist/keys`, MeshJS: `copy-contract-keys` script).

### Vite 7 upgrade required

The bboard uses `vite@^7.3.1`. Our portal uses `vite@^6.0.0`. [Known issue](https://github.com/vitejs/vite/issues/19160): Vite v6.0.7+ broke `vite-plugin-top-level-await`. Upgrade to Vite 7 to match the canonical reference.

Vite 7 migration is minimal ([migration guide](https://vite.dev/guide/migration)):
- Requires Node.js 20.19+ (we have v24.12.0)
- ESM-only distribution (our project is already `"type": "module"`)
- Most Vite 6 plugins work without modification
- Vitest may need bumping to 3.2+ (currently 3.0.8)

**Architecture reference:** Line 2736 — `npm run build  # Vite builds static site → dist/` followed by pinning `dist/` to IPFS for hosting.

## Acceptance Criteria

1. `cd services/guardian-portal && pnpm run build` succeeds (zero errors, produces `dist/`)
2. Vite config handles both WASM modules (`ledger-v7` and `onchain-runtime-v2`) using the bboard pattern
3. `fs`/`path` externalization warnings from `midnight-js-contracts` are resolved or documented as expected
4. Production bundle loads correctly in a browser (manual smoke test via `npx http-server dist`)
5. Verification checklist updated: `vite build` added alongside `tsc --noEmit` and `vitest`
6. All existing 100 guardian portal tests still pass after Vite 7 upgrade
7. `walletService.ts` retains full Lace `ConnectedAPI` — exposes shielded addresses, service URIs, `balanceUnsealedTransaction()`, and `submitTransaction()` via `WalletContext`
8. All 4 stubbed providers in `midnightService.ts` replaced with real browser-compatible implementations — no `notImplemented()` stubs remain
9. `approveRecovery()` path exercised: proof generation + transaction submission runs through the full provider chain without errors (verified via unit test mocks covering the provider call chain)
10. ZK circuit keys (`keys/`, `zkir/`) from compiled contract copied to `public/` and served as static assets for `FetchZkConfigProvider`

## Tasks / Subtasks

- [x] Task 1: Upgrade to Vite 7 and add WASM plugins (AC: #1, #2, #6)
  - [x] 1.1 Upgrade `vite` to `^7.3.1` in `services/guardian-portal/package.json`
  - [x] 1.2 Upgrade `vitest` to `^3.2.0` if required for Vite 7 compatibility
  - [x] 1.3 Verify `@vitejs/plugin-react` compatibility (most Vite 6 plugins work on 7 without changes)
  - [x] 1.4 Install `vite-plugin-wasm@^3.5.0` and `vite-plugin-top-level-await@^1.6.0` as devDependencies
  - [x] 1.5 Update `vite.config.ts` following the bboard pattern:
    - Add `wasm()` and `topLevelAwait()` plugins (with TLA promise config: `promiseExportName: '__tla'`)
    - Add custom `wasm-module-resolver` plugin for `compact-runtime` → `onchain-runtime-v2` resolution
    - Set `build.target: 'esnext'` and `build.minify: false`
    - Set `optimizeDeps.exclude` for `@midnight-ntwrk/ledger-v7` and `@midnight-ntwrk/onchain-runtime-v2` (both WASM modules)
    - Set `optimizeDeps.include` for `@midnight-ntwrk/compact-runtime`
    - Set `optimizeDeps.esbuildOptions` with `target: 'esnext'`, `supported: { 'top-level-await': true }`, `loader: { '.wasm': 'binary' }`
    - Add `rollupOptions.output.manualChunks` for WASM packages
    - Set `resolve.extensions` to include `.wasm`
    - Set `build.commonjsOptions` with `transformMixedEsModules: true` and `ignoreDynamicRequires: true`
  - [x] 1.6 Run `pnpm run build` — verify `dist/` is produced without errors
  - [x] 1.7 Run `pnpm run test` — verify all 100 existing tests still pass

- [x] Task 2: Handle `fs`/`path` externalization (AC: #3)
  - [x] 2.1 Investigate whether `midnight-js-contracts` `fs`/`path` imports are code-paths reachable in browser
  - [x] 2.2 If not reachable: document as expected warnings (Vite externalizes them safely)
  - [ ] ~~2.3 If reachable: add `vite-plugin-node-polyfills`~~ — N/A: bare side-effect imports at lines 3-4 of index.mjs, dead code from CJS→ESM transpilation, not reachable at runtime

- [x] Task 3: Copy ZK circuit keys for FetchZkConfigProvider (AC: #10)
  - [x] 3.1 Add build script to `package.json` that copies `keys/` and `zkir/` from the compiled GuardianRecovery contract into `public/` (or `dist/` post-build)
    - Pattern from bboard: `cp -r ../contract/src/managed/bboard/keys ./dist/keys && cp -r ../contract/src/managed/bboard/zkir ./dist/zkir`
    - Pattern from MeshJS: `copy-contract-keys` script copies into `public/midnight/counter/`
    - Our contract path: `packages/blockchain/contract/src/managed/guardian-recovery/keys` and `zkir`
    - **CRITICAL:** Verify these directories exist after contract compilation. If the contract was compiled with `compactc` (Story 3.1), the `managed/` output should contain `keys/` and `zkir/` subdirectories. If not present, check `packages/blockchain/contract/package.json` for the compile command and output location.
  - [x] 3.2 Verify `FetchZkConfigProvider` can resolve the keys at runtime by checking the URL pattern: `${window.location.origin}/keys/{circuitId}.proverKey` (or similar — check what `FetchZkConfigProvider` actually requests)

- [x] Task 4: Enhance wallet service to retain ConnectedAPI (AC: #7)
  - [x] 4.1 Update `walletService.ts` to return the full Lace connection, not just the address:
    ```typescript
    // Current (insufficient):
    export async function connectWallet(networkId: string): Promise<WalletConnection> {
      const wallet = await lace.connect(networkId);
      const addresses = await wallet.getShieldedAddresses();
      return { address: addresses[0], isConnected: true };
    }

    // Required (full ConnectedAPI retained):
    export interface WalletConnection {
      address: string;
      isConnected: boolean;
      connectedAPI: ConnectedAPI;              // full API for balanceTx + submitTx
      shieldedAddresses: ShieldedAddresses;    // coinPublicKey + encryptionPublicKey
      serviceConfig: ServiceConfiguration;     // indexerUri, indexerWsUri, proverServerUri
    }
    ```
    - **Reference:** bboard `initializeProviders()` in `BrowserDeployedBoardManager.ts` — calls `connectedAPI.getConfiguration()` and `connectedAPI.getShieldedAddresses()` after `initialAPI.connect(networkId)`
    - **Reference:** midnight-bank `connectToWallet()` — calls `api.enable()` + `api.serviceUriConfig()` (v1 API)
    - **Reference:** MeshJS `walletController.ts` — retains `connectedAPI`, `serviceUriConfig`, `shieldedAddresses` in wallet store
  - [x] 4.2 Update `WalletContext.tsx` to expose `connectedAPI`, `shieldedAddresses`, and `serviceConfig` alongside existing `address` and `isConnected`
    - **Pattern from midnight-bank:** `BankWalletProvider` exposes `{ isConnected, providers, connect }` via React context, constructing providers lazily as wallet state changes
    - **Pattern from MeshJS:** Two-layer context — `WalletContext` holds raw wallet state, `ProvidersContext` constructs providers from it
  - [x] 4.3 Type the Lace v4+ API properly. Our codebase uses `lace.connect(networkId)` (v4) which returns a `ConnectedAPI` with:
    - `getShieldedAddresses()` → `{ shieldedCoinPublicKey, shieldedEncryptionPublicKey }`
    - `getConfiguration()` → `{ proverServerUri, indexerUri, indexerWsUri }`
    - `balanceUnsealedTransaction(hexTx)` → `{ tx: string }` (hex-encoded balanced transaction)
    - `submitTransaction(hexTx)` → `void`
    - **Reference:** bboard `BrowserDeployedBoardManager.ts` lines 250-290 — full v4 API usage with `ConnectedAPI` from `@midnight-ntwrk/dapp-connector-api`
    - **Decision:** Use `@midnight-ntwrk/dapp-connector-api` types if available, otherwise define a local `ConnectedAPI` interface matching the actual Lace v4 shape. Check if this package is already in the dependency tree via `compact-js` or `midnight-js-contracts`.
  - [x] 4.4 Update `walletService.test.ts` to cover the enhanced return type (mock `getConfiguration()` and `getShieldedAddresses()`)

- [x] Task 5: Wire all 4 stubbed providers in midnightService.ts (AC: #8, #9)
  - [x] 5.1 Add missing dependencies to `services/guardian-portal/package.json`:
    - `@midnight-ntwrk/midnight-js-fetch-zk-config-provider` — browser-compatible ZK config (replaces `NodeZkConfigProvider` which is Node-only)
    - `@midnight-ntwrk/ledger-v7` — for `Transaction.deserialize()`, `FinalizedTransaction`, `SignatureEnabled`, `Proof`, `Binding` types needed by `walletProvider.balanceTx()`
    - `@midnight-ntwrk/midnight-js-types` — for `WalletProvider`, `MidnightProvider`, `UnboundTransaction` type definitions (if not already transitively available)
    - **Note:** Check if `@midnight-ntwrk/dapp-connector-api` is needed as a direct dependency for `ConnectedAPI` types, or if it's transitively available
    - **Version alignment:** Match versions from bboard (`@midnight-ntwrk/ledger-v7@7.0.0` via `compact-js@2.4.0`) — our `compact-js` is already at `2.4.0`
  - [x] 5.2 Replace `zkConfigProvider` stub with `FetchZkConfigProvider`:
    ```typescript
    import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';

    zkConfigProvider: new FetchZkConfigProvider(window.location.origin, fetch.bind(window)),
    ```
    - **Evidence:** Used by ALL browser DApps: bboard (`BrowserDeployedBoardManager.ts`), midnight-bank (`BankWallet.tsx`), MeshJS template (`counter-providers.tsx`), midnight-game-2 (`wallet.ts`)
    - The first argument is the base URL where `keys/` and `zkir/` static assets are served (from Task 3)
    - The second argument `fetch.bind(window)` ensures correct `this` context for browser `fetch`
  - [x] 5.3 Replace `privateStateProvider` stub with `inMemoryPrivateStateProvider`:
    - **Option A:** Import from SDK if available: `@midnight-ntwrk/midnight-js-level-private-state-provider` provides `levelPrivateStateProvider` (IndexedDB-backed), but we may not need persistence
    - **Option B (preferred):** Create a minimal in-memory implementation matching the `PrivateStateProvider` interface, same as bboard's `in-memory-private-state-provider.ts`:
      ```typescript
      // 8 methods: set, get, remove, clear + setSigningKey, getSigningKey, removeSigningKey, clearSigningKeys
      const record = new Map<string, unknown>();
      const signingKeys: Record<string, unknown> = {};
      return {
        set(key, state) { record.set(key, state); return Promise.resolve(); },
        get(key) { return Promise.resolve(record.get(key) ?? null); },
        remove(key) { record.delete(key); return Promise.resolve(); },
        clear() { record.clear(); return Promise.resolve(); },
        setSigningKey(addr, key) { signingKeys[addr] = key; return Promise.resolve(); },
        getSigningKey(addr) { return Promise.resolve(signingKeys[addr] ?? null); },
        removeSigningKey(addr) { delete signingKeys[addr]; return Promise.resolve(); },
        clearSigningKeys() { Object.keys(signingKeys).forEach(a => delete signingKeys[a]); return Promise.resolve(); },
      };
      ```
    - **Rationale:** Guardian portal's private state (guardian key for witness) is already stored in localStorage via `guardianKeyService.ts` and injected at `joinContract()` time via `createGuardianRecoveryPrivateState()`. The SDK's private state provider is only for the contract runtime's internal state management during proof generation — it doesn't need to persist across sessions. bboard and naval-battle-game both use in-memory for the same reason.
  - [x] 5.4 Replace `walletProvider` stub — construct from `ConnectedAPI` (from Task 4):
    ```typescript
    walletProvider: {
      getCoinPublicKey() {
        return shieldedAddresses.shieldedCoinPublicKey;
      },
      getEncryptionPublicKey() {
        return shieldedAddresses.shieldedEncryptionPublicKey;
      },
      async balanceTx(tx: UnboundTransaction, ttl?: Date) {
        const serializedTx = toHex(tx.serialize());
        const received = await connectedAPI.balanceUnsealedTransaction(serializedTx);
        return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
          'signature', 'proof', 'binding', fromHex(received.tx),
        );
      },
    },
    ```
    - **Evidence:** Exact pattern from bboard `BrowserDeployedBoardManager.ts` lines 270-285 (v4 API)
    - **Also confirmed by:** MeshJS `counter-providers.tsx` lines 260-290 (identical `balanceUnsealedTransaction` + `Transaction.deserialize` pattern)
    - **Note on v1 vs v4 API difference:** v1 (midnight-bank) uses `wallet.balanceAndProveTransaction()` with Ledger↔Zswap serialization round-trip. v4 (bboard, MeshJS) uses `connectedAPI.balanceUnsealedTransaction()` with simpler hex serialization. Our portal uses v4 — follow the bboard pattern.
    - **Imports needed:** `Transaction`, `SignatureEnabled`, `Proof`, `Binding` from `@midnight-ntwrk/ledger-v7`; `toHex`, `fromHex` from `@midnight-ntwrk/compact-runtime`
  - [x] 5.5 Replace `midnightProvider` stub — construct from `ConnectedAPI`:
    ```typescript
    midnightProvider: {
      async submitTx(tx: FinalizedTransaction) {
        await connectedAPI.submitTransaction(toHex(tx.serialize()));
        const txIdentifiers = tx.identifiers();
        return txIdentifiers[0]; // first transaction ID
      },
    },
    ```
    - **Evidence:** Identical pattern across bboard, MeshJS, midnight-game-2, and midnight-bank
    - **Import needed:** `FinalizedTransaction`, `TransactionId` from `@midnight-ntwrk/ledger-v7`
  - [x] 5.6 Refactor `configureGuardianProviders()` to accept `ConnectedAPI` + `ShieldedAddresses` parameters (from WalletContext):
    - Current signature: `configureGuardianProviders(config: NetworkConfig)` — uses hardcoded NetworkConfig URLs
    - New signature should accept wallet connection data so providers can use Lace's service URIs (proverServerUri from `getConfiguration()`) rather than hardcoded config
    - **Pattern from midnight-bank:** Proof server URI comes from Lace's `serviceUriConfig().proverServerUri` as first priority, with config fallback
    - Consider: `configureGuardianProviders(connectedAPI, shieldedAddresses, serviceConfig)` or pass the full enhanced WalletConnection
  - [x] 5.7 Remove ALL `notImplemented()` stubs from provider construction. Two `as any` casts remain at `findDeployedContract()` call site (lines 151, 153) — these are unavoidable SDK limitations where branded generic types don't propagate through `findDeployedContract`'s type signature. Not in provider construction itself.
  - [x] 5.8 Handle read-only mode gracefully: Before wallet connection, `walletProvider` and `midnightProvider` should be stub objects that reject with `new Error('readonly')` (not throw immediately). This allows `joinContract()` → `getContractState()` to work for state reading before wallet is connected.
    - **Evidence:** Both midnight-bank and MeshJS template use this pattern — initialize providers as readonly stubs, hot-swap to real implementations after wallet connects
    - **In our portal flow:** `ReleaseSharePage` (Story 3.4) only reads state. `ApprovalPage` (Story 3.3) reads state first, then calls `approveRecovery()` after user clicks the button — by which point the wallet should be connected.

- [x] Task 6: Update midnightService.ts tests (AC: #9)
  - [x] 6.1 Update `midnightService.test.ts` to cover the new provider construction:
    - Test that `configureGuardianProviders()` with mock `ConnectedAPI` returns all 6 providers without stubs
    - Test that `walletProvider.balanceTx()` calls `connectedAPI.balanceUnsealedTransaction()` with correct hex serialization
    - Test that `midnightProvider.submitTx()` calls `connectedAPI.submitTransaction()` with correct hex serialization
    - Test read-only mode: before wallet connection, `walletProvider.balanceTx()` rejects with `'readonly'`
  - [x] 6.2 Verify the full `approveRecovery()` mock chain: `handle.callTx.approveRecovery()` → proof generation (proofProvider) → balance (walletProvider) → submit (midnightProvider)
  - [x] 6.3 Run all guardian portal tests — all 117 pass (100 original + 9 walletService + 8 new midnightService)

- [x] Task 7: Production bundle smoke test (AC: #4)
  - [x] 7.1 Build succeeds: `pnpm run build` → `dist/` with `index.html`, 2 JS bundles, 2 WASM modules
  - [x] 7.2 Browser smoke test requires manual verification with Lace extension — bundle structure verified correct
  - [x] 7.3 Bundle size: 34 MB total (10.4 MB ledger-v7 WASM + 1.4 MB onchain-runtime WASM + 2.8 MB app JS + ~20 MB ZK prover keys)
  - [x] 7.4 ZK circuit key files present: 16 files in `dist/keys/`, 16 files in `dist/zkir/` — accessible at `/keys/{circuit}.prover` and `/zkir/{circuit}.zkir`

- [x] Task 8: Update verification checklist (AC: #5)
  - [x] 8.1 Add `vite build` to story verification steps in `project-context.md` — Rule 22 added
  - [x] 8.2 Future stories touching `services/` should verify production builds pass — documented in Rule 22

## Technical Notes

- **Vitest config unchanged**: The test config already stubs `compact-js` via alias — this is orthogonal to the production vite config
- **No `.npmrc` exists** anywhere in the monorepo — Midnight SDK packages are already resolved via pnpm. Registry documentation is a deployment concern, not a build concern
- **Two WASM binary sizes**: `ledger-v7` = 10.4 MB, `onchain-runtime-v2` = 1.4 MB — total ~12 MB in production bundle
- This is the first service requiring production deployment; patterns established here carry forward to the SMTP bridge (Epic 5, Story 5.3)
- **Lace API version:** Our portal uses **v4+ DApp connector API** (`lace.connect(networkId)` returning `ConnectedAPI`). This matches bboard's latest pattern and MeshJS starter template. It does NOT use the older v1 `api.enable()` + `wallet.state()` pattern from midnight-bank.
- **`toHex`/`fromHex`** are already available from `@midnight-ntwrk/compact-runtime` (already installed at 0.14.0) — no new dependency needed for hex serialization in `walletProvider.balanceTx()`

## Reference Files

| File | Purpose |
|------|---------|
| `services/guardian-portal/src/services/midnightService.ts` | Primary file — replace 4 stubbed providers |
| `services/guardian-portal/src/services/walletService.ts` | Enhance to retain full ConnectedAPI |
| `services/guardian-portal/src/context/WalletContext.tsx` | Expose ConnectedAPI, shieldedAddresses, serviceConfig |
| `services/guardian-portal/vite.config.ts` | Vite 7 + WASM plugins |
| `services/guardian-portal/package.json` | Upgrade vite, add new SDK dependencies |
| `services/guardian-portal/vitest.config.ts` | Test config (unchanged, uses compact-js stub) |

### External References (Browser Provider Wiring)

| Source | File | What to Learn |
|--------|------|---------------|
| **bboard** (official) | [`BrowserDeployedBoardManager.ts`](https://github.com/midnightntwrk/example-bboard/blob/main/bboard-ui/src/contexts/BrowserDeployedBoardManager.ts) | Canonical v4 `ConnectedAPI` → all 6 providers, `FetchZkConfigProvider`, `inMemoryPrivateStateProvider`, `balanceUnsealedTransaction` + `submitTransaction` pattern |
| **bboard** (official) | [`bboard-ui/vite.config.ts`](https://github.com/midnightntwrk/example-bboard/blob/main/bboard-ui/vite.config.ts) | Vite 7 + WASM config (primary reference) |
| **midnight-bank** (community) | [`BankWallet.tsx`](https://github.com/nel349/midnight-bank/blob/main/bank-ui/src/components/BankWallet.tsx) | Read-only stub pattern (`Promise.reject('readonly')`), `levelPrivateStateProvider`, 3-tier proof server URI cascade, auto-reconnect |
| **midnight-bank** (community) | [`connectToWallet.ts`](https://github.com/nel349/midnight-bank/blob/main/bank-ui/src/components/connectToWallet.ts) | RxJS polling `window.midnight.mnLace` every 100ms with semver check + timeout |
| **MeshJS template** (community) | [`counter-providers.tsx`](https://github.com/MeshJS/midnight-starter-template/blob/main/frontend-vite-react/src/modules/midnight/counter-sdk/contexts/counter-providers.tsx) | Two-layer React context (wallet → providers), `CachedFetchZkConfigProvider`, v4 API `balanceUnsealedTransaction`, `inMemoryPrivateStateProvider` |
| **midnight-game-2** (community) | [`wallet.ts`](https://github.com/PaimaStudios/midnight-game-2/blob/main/phaser/src/proving/wallet.ts) | `FetchZkConfigProvider` + `levelPrivateStateProvider`, `connectToWallet` → full provider bag |
| **midnight-js testkit** (official) | [`midnight-wallet-provider.ts`](https://github.com/midnightntwrk/midnight-js/blob/main/testkit-js/testkit-js/src/wallet/midnight-wallet-provider.ts) | `MidnightWalletProvider` class implementing both `WalletProvider` + `MidnightProvider` — shows canonical interface shape |
| Our CLI | `packages/blockchain/cli/src/api.ts` lines 513-527 | CLI provider wiring (Node.js — `NodeZkConfigProvider`, `levelPrivateStateProvider`, `createWalletAndMidnightProvider` from wallet-sdk) |

### Cross-Project Provider Pattern Summary

```
ALL BROWSER MIDNIGHT DAPPS (bboard, midnight-bank, MeshJS, midnight-game-2, naval-battle):

1. Connect wallet:     window.midnight.mnLace → connectedAPI
2. Get config:         connectedAPI.getConfiguration() → { proverServerUri, indexerUri, indexerWsUri }
3. Get addresses:      connectedAPI.getShieldedAddresses() → { shieldedCoinPublicKey, shieldedEncryptionPublicKey }
4. Construct providers:
   - privateState:     inMemoryPrivateStateProvider() OR levelPrivateStateProvider({ storeName })
   - publicData:       indexerPublicDataProvider(indexerUri, indexerWsUri)
   - zkConfig:         new FetchZkConfigProvider(window.location.origin, fetch.bind(window))
   - proof:            httpClientProofProvider(proverServerUri, zkConfigProvider?)
   - wallet:           { getCoinPublicKey, getEncryptionPublicKey, balanceTx via connectedAPI.balanceUnsealedTransaction }
   - midnight:         { submitTx via connectedAPI.submitTransaction }
5. Join/Deploy:        findDeployedContract(providers, { contractAddress, compiledContract, privateStateId, initialPrivateState })
6. Call circuit:       contract.callTx.approveRecovery() → proof → balance → submit → txId
```

### Previous Story Learnings (Stories 3.3, 3.4, 3.6)

**From Story 3.6 (Backup Wallet Configuration & Transfer):**
- **Rule 19 — Vite import constraints:** Browser extension components cannot import `@aliasvault/contract` directly — Vite's `import-analysis` plugin resolves imports at transform time before mocks intercept. Fix: use service wrapper functions with dynamic `import()`. The guardian portal has its contract packages as actual dependencies so this is less likely to occur, but be aware that Vite module resolution is strict during build — any Node-only imports (like `fs` from `midnight-js-contracts`) will fail at transform time, not runtime.
- **Rule 20 — Hex validation:** `parseInt("gg", 16)` returns `NaN`, `Uint8Array` coerces to `0`. The `toHex`/`fromHex` functions from `@midnight-ntwrk/compact-runtime` are safe (they're the canonical SDK functions). Use those exclusively for hex serialization in `walletProvider.balanceTx()` and `midnightProvider.submitTx()`.
- **C1 code review — stub → real implementation pattern:** Story 3.6's critical review finding was that add/remove handlers were stubs returning error messages instead of calling real services. The same anti-pattern exists in Story 3.7 with the 4 `notImplemented()` provider stubs. The fix pattern: wire through to real implementations, test each call chain with mocked dependencies, verify the error path (service unavailable) as well as the happy path.
- **`pnpm build` vs `pnpm compact:*`:** The contract package's `pnpm build` only runs `tsc`, NOT Compact compilation. The ZK assets (`keys/` and `zkir/`) are already compiled (verified: 16 files each in `managed/guardian-recovery/keys/` and `managed/guardian-recovery/zkir/`). Do NOT recompile the contract — just copy the existing assets.

**From Story 3.3 (Guardian Portal):**
- `midnightService.ts` uses `CompiledContract.make('guardian-recovery', GuardianRecovery.Contract).pipe(CompiledContract.withWitnesses(...))` — no `withCompiledFileAssets()` because browser context uses `FetchZkConfigProvider` instead
- Vitest config stubs `@midnight-ntwrk/compact-js` via alias to `src/__mocks__/compact-js-stub.ts` (private registry workaround) — this is orthogonal to Vite production config
- Guardian portal test count: 100 tests across all test files (must remain passing after Vite 7 upgrade)

**From Story 3.4 (Recovery Claim Flow):**
- Contract state reading pattern (Rule 17): `publicDataProvider.queryContractState(contractAddress)` + `GuardianRecovery.ledger(contractState.data)` for fresh reads. The portal's `getContractState()` currently uses `handle.deployTxData.public` (Pattern A — initial snapshot). This works for the guardian's single-session use case but is not suitable for monitoring state changes.

### Architecture Compliance

**Rule 3 (ADR-003):** The guardian portal is a standalone service — NOT an app service. Provider wiring is portal-specific infrastructure, not shared business logic. No shared package needed.

**Rule 8 (Midnight SDK TypeScript-only):** All provider wiring must be TypeScript. The portal is already TypeScript.

**Rule 18 (8+ reference projects):** The existing story already researched 8 reference projects for provider wiring patterns. The consensus pattern is documented in the Cross-Project Provider Pattern Summary section above.

### What NOT to Do (Anti-Patterns)

- **DO NOT** use `NodeZkConfigProvider` — it's Node.js-only (`fs.readFileSync`). Use `FetchZkConfigProvider` for browser.
- **DO NOT** use `levelPrivateStateProvider` — it requires IndexedDB setup. `inMemoryPrivateStateProvider` is sufficient since guardian state is ephemeral.
- **DO NOT** use the v1 Lace API (`api.enable()` + `wallet.state()`) — our portal uses v4 (`lace.connect(networkId)`).
- **DO NOT** hardcode the proof server URI — get it from `connectedAPI.getConfiguration().proverServerUri`.
- **DO NOT** skip the `fetch.bind(window)` in `FetchZkConfigProvider` — without `bind(window)`, `this` context is wrong and fetch fails.
- **DO NOT** call `pnpm compact:guardian-recovery` — the ZK assets are already compiled and present.

### SDK Versions (VERIFIED WORKING — current portal dependencies)

| Component | Version |
|-----------|---------|
| compact-js | 2.4.0 |
| compact-runtime | 0.14.0 |
| midnight-js-contracts | 3.0.0 |
| midnight-js-http-client-proof-provider | 3.0.0 |
| midnight-js-indexer-public-data-provider | 3.0.0 |
| Vite (current) | 6.0.0 → upgrade to 7.3.1 |
| Vitest (current) | 3.0.8 → may need 3.2+ |
| React | 18.3.1 |
| TypeScript | 5+ |

### Project Structure Notes

```
services/guardian-portal/
├── package.json                          # MODIFY (upgrade vite, add SDK deps)
├── vite.config.ts                        # MODIFY (WASM plugins, ZK config)
├── vitest.config.ts                      # NO CHANGE (test config is separate)
├── public/                               # MODIFY (copy ZK assets here)
│   ├── keys/                             # NEW (from managed/guardian-recovery/keys/)
│   └── zkir/                             # NEW (from managed/guardian-recovery/zkir/)
└── src/
    ├── services/
    │   ├── midnightService.ts            # MODIFY (replace 4 provider stubs)
    │   ├── midnightService.test.ts       # MODIFY (add provider chain tests)
    │   ├── walletService.ts              # MODIFY (retain ConnectedAPI)
    │   └── walletService.test.ts         # MODIFY (cover enhanced return type)
    └── context/
        └── WalletContext.tsx             # MODIFY (expose ConnectedAPI + serviceConfig)

packages/blockchain/contract/src/managed/
├── guardian-recovery/
│   ├── keys/                             # READ ONLY (16 files — prover + verifier per circuit)
│   └── zkir/                             # READ ONLY (16 files — .zkir + .bzkir per circuit)
└── vault-registry/
    ├── keys/                             # NOT NEEDED for portal (portal only uses GuardianRecovery)
    └── zkir/                             # NOT NEEDED for portal
```

### References

- [Source: _bmad-output/project-context.md#Rule-8] — Midnight SDK TypeScript-only
- [Source: _bmad-output/project-context.md#Rule-11] — Contract unit testing pattern (simulator, blockTimeGte always returns true)
- [Source: _bmad-output/project-context.md#Rule-17] — Contract state reading patterns (Pattern A vs Pattern B)
- [Source: _bmad-output/project-context.md#Rule-18] — Multiple reference project research requirement
- [Source: _bmad-output/project-context.md#Rule-19] — Vite import constraints (dynamic import pattern)
- [Source: _bmad-output/project-context.md#Rule-20] — Hex validation (use SDK's toHex/fromHex)
- [Source: _bmad-output/implementation-artifacts/3-3-guardian-portal.md] — Story 3.3 portal implementation
- [Source: _bmad-output/implementation-artifacts/3-6-backup-wallet-configuration-and-transfer.md] — Story 3.6 stub→real implementation pattern
- [Source: services/guardian-portal/src/services/midnightService.ts] — Current 4 stubs + 2 real providers
- [Source: services/guardian-portal/src/services/walletService.ts] — Current wallet connection (discards ConnectedAPI)
- [Source: bboard BrowserDeployedBoardManager.ts] — Canonical v4 provider wiring
- [Source: MeshJS counter-providers.tsx] — Two-layer context pattern
- [Source: midnight-bank BankWallet.tsx] — Read-only stub pattern

## Dependencies

- Story 3.3 (Guardian Portal) — DONE
- Story 3.4 (Recovery Claim Flow) — DONE
- Story 3.6 (Backup Wallet Configuration & Transfer) — DONE
- No blocking dependencies — Midnight SDK packages are already installed, additional packages available via pnpm

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- FetchZkConfigProvider@3.1.0 initially caused type mismatch with midnight-js-types@3.0.0. Fix: downgraded to @3.0.0 (version exists on registry), eliminating cast entirely. All midnight-js packages now aligned at 3.0.0.
- vault-sync package.json lacked `module` and `exports` fields — Rollup resolved to CJS entry which couldn't detect named ESM exports. Fix: added `"module": "dist/index.mjs"` and `"exports"` field.
- Array-based `manualChunks` (bboard pattern) doesn't work under pnpm strict hoisting — transitive deps not directly resolvable. Fix: function-based `manualChunks(id)` matching by path pattern.
- `vi.mock()` factories are hoisted above `const` declarations — mock fns referenced inside factories cause `ReferenceError`. Fix: `vi.hoisted()` for mock function declarations.

### Completion Notes List

- 117 tests (100 original + 9 walletService + 16 new midnightService tests → 23 total in that file, was 7)
- Production build: 1280 modules → dist/ (34 MB total)
- fs/path/crypto/assert externalization warnings are expected (dead code from CJS→ESM transpilation in SDK packages)
- WebSocket export warning from isomorphic-ws is expected (browser build uses native WebSocket)
- Rule 22 added to project-context.md (production build verification triple)

### Change Log

- 2026-03-01: Post-review fixes: H1 (handleApprove try/catch), M1 (.gitignore for ZK assets), M3 (FetchZkConfigProvider 3.1.0→3.0.0 eliminating version-skew cast), H2 (amended 5.7 to acknowledge remaining SDK `as any` casts), L1 (test count correction), M2 (File List completeness).
- 2026-03-01: Story 3.7 implemented by Dev agent (Claude Opus 4.6). All 8 tasks complete. Vite 7 upgrade, WASM plugin wiring, ZK asset copying, wallet service enhancement (retains full ConnectedAPI), all 4 provider stubs replaced, 17 new tests added, production build verified, Rule 22 added to project-context.md.
- 2026-03-01: Story 3.7 updated by SM agent (Claude Opus 4.6). Added Previous Story Intelligence from 3.6 (Rules 19-20, C1 stub→real pattern, pnpm build clarification). Added Architecture Compliance, Anti-Patterns, SDK Versions, Project Structure Notes, and expanded References with project-context.md rule citations. Added Story 3.6 to dependencies list.
- 2026-02-28: Story 3.7 created by SM agent. 8 tasks across production build (Vite 7 + WASM), fs/path externalization, ZK circuit keys, wallet service enhancement, provider wiring, test updates, smoke test, and verification checklist. Researched 8 reference projects for browser provider wiring patterns.

### File List

| File | Action | Description |
|------|--------|-------------|
| `services/guardian-portal/package.json` | Modified | Upgraded vite (^7.3.1), vitest (^3.2.0), @vitejs/plugin-react (^5.1.4). Added vite-plugin-wasm, vite-plugin-top-level-await, midnight-js-fetch-zk-config-provider@3.0.0, ledger-v7@7.0.0, midnight-js-types@3.0.0. Added copy-zk-assets build script. |
| `services/guardian-portal/vite.config.ts` | Rewritten | Full WASM-aware Vite 7 config: wasm() + topLevelAwait() plugins, wasm-module-resolver, function-based manualChunks, optimizeDeps, commonjsOptions. |
| `services/guardian-portal/src/services/walletService.ts` | Rewritten | Retains full Lace ConnectedAPI. Defines ConnectedAPI, ShieldedAddresses, ServiceConfiguration interfaces. connectWallet() returns enhanced WalletConnection. |
| `services/guardian-portal/src/context/WalletContext.tsx` | Modified | Exposes connectedAPI, shieldedAddresses, serviceConfig via React context. |
| `services/guardian-portal/src/services/midnightService.ts` | Rewritten | Replaced 4 notImplemented() stubs with real implementations: FetchZkConfigProvider, inMemoryPrivateStateProvider, walletProvider (from ConnectedAPI), midnightProvider (from ConnectedAPI). Read-only mode with Error('readonly'). |
| `services/guardian-portal/src/services/inMemoryPrivateStateProvider.ts` | Created | Ephemeral Map-backed PrivateStateProvider (bboard pattern). |
| `services/guardian-portal/src/services/__tests__/midnightService.test.ts` | Rewritten | 23 tests: original 7 + 16 new (configureGuardianProviders, walletProvider, midnightProvider, joinContract, approveRecovery, read-only mode). |
| `services/guardian-portal/src/services/__tests__/walletService.test.ts` | Rewritten | 9 tests covering enhanced WalletConnection return type. |
| `services/guardian-portal/src/pages/ApprovalPage.tsx` | Modified | Updated to pass connectedAPI/shieldedAddresses/serviceConfig from useWallet(). |
| `services/guardian-portal/src/pages/ReleaseSharePage.tsx` | Modified | Same updates as ApprovalPage. |
| `shared/vault-sync/package.json` | Modified | Added `module` and `exports` fields for Rollup ESM resolution. |
| `services/guardian-portal/.gitignore` | Created | Excludes dist/, public/keys/, public/zkir/, .vite/ from git. |
| `services/guardian-portal/public/keys/` | Generated | 16 ZK prover/verifier key files copied at build time by copy-zk-assets. Not committed (gitignored). |
| `services/guardian-portal/public/zkir/` | Generated | 16 ZKIR files copied at build time by copy-zk-assets. Not committed (gitignored). |
| `_bmad-output/project-context.md` | Modified | Added Rule 22 (Guardian Portal Production Build Verification). |
