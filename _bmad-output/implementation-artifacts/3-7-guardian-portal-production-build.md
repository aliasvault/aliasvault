# Story 3.7: Guardian Portal Production Build & Provider Wiring

Status: ready-for-dev

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

- [ ] Task 1: Upgrade to Vite 7 and add WASM plugins (AC: #1, #2, #6)
  - [ ] 1.1 Upgrade `vite` to `^7.3.1` in `services/guardian-portal/package.json`
  - [ ] 1.2 Upgrade `vitest` to `^3.2.0` if required for Vite 7 compatibility
  - [ ] 1.3 Verify `@vitejs/plugin-react` compatibility (most Vite 6 plugins work on 7 without changes)
  - [ ] 1.4 Install `vite-plugin-wasm@^3.5.0` and `vite-plugin-top-level-await@^1.6.0` as devDependencies
  - [ ] 1.5 Update `vite.config.ts` following the bboard pattern:
    - Add `wasm()` and `topLevelAwait()` plugins (with TLA promise config: `promiseExportName: '__tla'`)
    - Add custom `wasm-module-resolver` plugin for `compact-runtime` → `onchain-runtime-v2` resolution
    - Set `build.target: 'esnext'` and `build.minify: false`
    - Set `optimizeDeps.exclude` for `@midnight-ntwrk/ledger-v7` and `@midnight-ntwrk/onchain-runtime-v2` (both WASM modules)
    - Set `optimizeDeps.include` for `@midnight-ntwrk/compact-runtime`
    - Set `optimizeDeps.esbuildOptions` with `target: 'esnext'`, `supported: { 'top-level-await': true }`, `loader: { '.wasm': 'binary' }`
    - Add `rollupOptions.output.manualChunks` for WASM packages
    - Set `resolve.extensions` to include `.wasm`
    - Set `build.commonjsOptions` with `transformMixedEsModules: true` and `ignoreDynamicRequires: true`
  - [ ] 1.6 Run `pnpm run build` — verify `dist/` is produced without errors
  - [ ] 1.7 Run `pnpm run test` — verify all 100 existing tests still pass

- [ ] Task 2: Handle `fs`/`path` externalization (AC: #3)
  - [ ] 2.1 Investigate whether `midnight-js-contracts` `fs`/`path` imports are code-paths reachable in browser
  - [ ] 2.2 If not reachable: document as expected warnings (Vite externalizes them safely)
  - [ ] 2.3 If reachable: add `vite-plugin-node-polyfills` (bboard lists `node-stdlib-browser@^1.3.1` as dependency; MeshJS uses `vite-plugin-node-polyfills@^0.25.0` for `Buffer` and `process` polyfills)

- [ ] Task 3: Copy ZK circuit keys for FetchZkConfigProvider (AC: #10)
  - [ ] 3.1 Add build script to `package.json` that copies `keys/` and `zkir/` from the compiled GuardianRecovery contract into `public/` (or `dist/` post-build)
    - Pattern from bboard: `cp -r ../contract/src/managed/bboard/keys ./dist/keys && cp -r ../contract/src/managed/bboard/zkir ./dist/zkir`
    - Pattern from MeshJS: `copy-contract-keys` script copies into `public/midnight/counter/`
    - Our contract path: `packages/blockchain/contract/src/managed/guardian-recovery/keys` and `zkir`
    - **CRITICAL:** Verify these directories exist after contract compilation. If the contract was compiled with `compactc` (Story 3.1), the `managed/` output should contain `keys/` and `zkir/` subdirectories. If not present, check `packages/blockchain/contract/package.json` for the compile command and output location.
  - [ ] 3.2 Verify `FetchZkConfigProvider` can resolve the keys at runtime by checking the URL pattern: `${window.location.origin}/keys/{circuitId}.proverKey` (or similar — check what `FetchZkConfigProvider` actually requests)

- [ ] Task 4: Enhance wallet service to retain ConnectedAPI (AC: #7)
  - [ ] 4.1 Update `walletService.ts` to return the full Lace connection, not just the address:
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
  - [ ] 4.2 Update `WalletContext.tsx` to expose `connectedAPI`, `shieldedAddresses`, and `serviceConfig` alongside existing `address` and `isConnected`
    - **Pattern from midnight-bank:** `BankWalletProvider` exposes `{ isConnected, providers, connect }` via React context, constructing providers lazily as wallet state changes
    - **Pattern from MeshJS:** Two-layer context — `WalletContext` holds raw wallet state, `ProvidersContext` constructs providers from it
  - [ ] 4.3 Type the Lace v4+ API properly. Our codebase uses `lace.connect(networkId)` (v4) which returns a `ConnectedAPI` with:
    - `getShieldedAddresses()` → `{ shieldedCoinPublicKey, shieldedEncryptionPublicKey }`
    - `getConfiguration()` → `{ proverServerUri, indexerUri, indexerWsUri }`
    - `balanceUnsealedTransaction(hexTx)` → `{ tx: string }` (hex-encoded balanced transaction)
    - `submitTransaction(hexTx)` → `void`
    - **Reference:** bboard `BrowserDeployedBoardManager.ts` lines 250-290 — full v4 API usage with `ConnectedAPI` from `@midnight-ntwrk/dapp-connector-api`
    - **Decision:** Use `@midnight-ntwrk/dapp-connector-api` types if available, otherwise define a local `ConnectedAPI` interface matching the actual Lace v4 shape. Check if this package is already in the dependency tree via `compact-js` or `midnight-js-contracts`.
  - [ ] 4.4 Update `walletService.test.ts` to cover the enhanced return type (mock `getConfiguration()` and `getShieldedAddresses()`)

- [ ] Task 5: Wire all 4 stubbed providers in midnightService.ts (AC: #8, #9)
  - [ ] 5.1 Add missing dependencies to `services/guardian-portal/package.json`:
    - `@midnight-ntwrk/midnight-js-fetch-zk-config-provider` — browser-compatible ZK config (replaces `NodeZkConfigProvider` which is Node-only)
    - `@midnight-ntwrk/ledger-v7` — for `Transaction.deserialize()`, `FinalizedTransaction`, `SignatureEnabled`, `Proof`, `Binding` types needed by `walletProvider.balanceTx()`
    - `@midnight-ntwrk/midnight-js-types` — for `WalletProvider`, `MidnightProvider`, `UnboundTransaction` type definitions (if not already transitively available)
    - **Note:** Check if `@midnight-ntwrk/dapp-connector-api` is needed as a direct dependency for `ConnectedAPI` types, or if it's transitively available
    - **Version alignment:** Match versions from bboard (`@midnight-ntwrk/ledger-v7@7.0.0` via `compact-js@2.4.0`) — our `compact-js` is already at `2.4.0`
  - [ ] 5.2 Replace `zkConfigProvider` stub with `FetchZkConfigProvider`:
    ```typescript
    import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';

    zkConfigProvider: new FetchZkConfigProvider(window.location.origin, fetch.bind(window)),
    ```
    - **Evidence:** Used by ALL browser DApps: bboard (`BrowserDeployedBoardManager.ts`), midnight-bank (`BankWallet.tsx`), MeshJS template (`counter-providers.tsx`), midnight-game-2 (`wallet.ts`)
    - The first argument is the base URL where `keys/` and `zkir/` static assets are served (from Task 3)
    - The second argument `fetch.bind(window)` ensures correct `this` context for browser `fetch`
  - [ ] 5.3 Replace `privateStateProvider` stub with `inMemoryPrivateStateProvider`:
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
  - [ ] 5.4 Replace `walletProvider` stub — construct from `ConnectedAPI` (from Task 4):
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
  - [ ] 5.5 Replace `midnightProvider` stub — construct from `ConnectedAPI`:
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
  - [ ] 5.6 Refactor `configureGuardianProviders()` to accept `ConnectedAPI` + `ShieldedAddresses` parameters (from WalletContext):
    - Current signature: `configureGuardianProviders(config: NetworkConfig)` — uses hardcoded NetworkConfig URLs
    - New signature should accept wallet connection data so providers can use Lace's service URIs (proverServerUri from `getConfiguration()`) rather than hardcoded config
    - **Pattern from midnight-bank:** Proof server URI comes from Lace's `serviceUriConfig().proverServerUri` as first priority, with config fallback
    - Consider: `configureGuardianProviders(connectedAPI, shieldedAddresses, serviceConfig)` or pass the full enhanced WalletConnection
  - [ ] 5.7 Remove ALL `notImplemented()` stubs and `as any` casts from provider construction
  - [ ] 5.8 Handle read-only mode gracefully: Before wallet connection, `walletProvider` and `midnightProvider` should be stub objects that reject with `new Error('readonly')` (not throw immediately). This allows `joinContract()` → `getContractState()` to work for state reading before wallet is connected.
    - **Evidence:** Both midnight-bank and MeshJS template use this pattern — initialize providers as readonly stubs, hot-swap to real implementations after wallet connects
    - **In our portal flow:** `ReleaseSharePage` (Story 3.4) only reads state. `ApprovalPage` (Story 3.3) reads state first, then calls `approveRecovery()` after user clicks the button — by which point the wallet should be connected.

- [ ] Task 6: Update midnightService.ts tests (AC: #9)
  - [ ] 6.1 Update `midnightService.test.ts` to cover the new provider construction:
    - Test that `configureGuardianProviders()` with mock `ConnectedAPI` returns all 6 providers without stubs
    - Test that `walletProvider.balanceTx()` calls `connectedAPI.balanceUnsealedTransaction()` with correct hex serialization
    - Test that `midnightProvider.submitTx()` calls `connectedAPI.submitTransaction()` with correct hex serialization
    - Test read-only mode: before wallet connection, `walletProvider.balanceTx()` rejects with `'readonly'`
  - [ ] 6.2 Verify the full `approveRecovery()` mock chain: `handle.callTx.approveRecovery()` → proof generation (proofProvider) → balance (walletProvider) → submit (midnightProvider)
  - [ ] 6.3 Run all guardian portal tests — all 100+ must pass

- [ ] Task 7: Production bundle smoke test (AC: #4)
  - [ ] 7.1 Serve `dist/` locally with `npx http-server dist`
  - [ ] 7.2 Verify page loads, wallet connect renders, no WASM-related console errors
  - [ ] 7.3 Verify bundle size is reasonable (~12 MB expected from two WASM binaries)
  - [ ] 7.4 Verify ZK circuit key files are accessible at their expected URLs (`/keys/`, `/zkir/`)

- [ ] Task 8: Update verification checklist (AC: #5)
  - [ ] 8.1 Add `vite build` to story verification steps in `project-context.md`
  - [ ] 8.2 Future stories touching `services/` should verify production builds pass

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

## Dependencies

- Story 3.3 (Guardian Portal) — DONE
- Story 3.4 (Recovery Claim Flow) — DONE
- No blocking dependencies — Midnight SDK packages are already installed, additional packages available via pnpm

## Dev Agent Record

- Model: (pending)
- Debug log: (pending)
- Completion notes: (pending)
