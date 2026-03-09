# Story 5.3: SMTP Bridge Service

Status: done

## Story

As a system,
I want to receive email webhooks, verify alias ownership on-chain, encrypt emails, store them on IPFS, and notify vault owners via contract,
so that only legitimate emails reach vault owners through a privacy-preserving pipeline.

## Acceptance Criteria

1. Express TypeScript service at `services/smtp-bridge/`
2. Full Midnight client setup: `WalletFacade` (HDWallet + ShieldedWallet + UnshieldedWallet + DustWallet), proof server, LevelDB private state, NodeZkConfigProvider
3. Bridge wallet holds NIGHT balance for DUST generation (gas)
4. Bridge relay secret key stored in environment variable; relay commitment derived at startup and logged
5. `POST /receive-email` webhook endpoint accepts `{ to, from, subject, body, attachments? }`
6. Extract alias from `to` header (localPart@domain), hash to `Bytes<32>` using SHA-256 (must match `aliasUtils.ts` hashing)
7. Query `AliasRegistry.getContractAddress(aliasHash)` to find owner's VaultRegistry address
8. Read `emailPublicKey` from owner's VaultRegistry public ledger via indexer
9. Encrypt email with X25519 hybrid encryption (ADR-008): ephemeral keypair, `nacl.box()`, package `[ephemeralPubKey(32) | nonce(24) | ciphertext]`
10. Upload encrypted blob to IPFS via `@aliasvault/ipfs-service` PinataProvider
11. Update inbox manifest on IPFS: append `{ cid, ts }` entry, no sender metadata
12. Call `notifyNewMail(manifestCid)` on owner's VaultRegistry (authorized via relay key witness)
13. Per-user serialization queue: one `notifyNewMail` tx at a time per VaultRegistry contract
14. Configurable batch window (default 30s): collect emails per user, then single manifest update + tx
15. Return 404 if alias not registered; return 200 with `{ cid }` on success
16. Rate limiting: max 100 emails/minute per alias
17. Email size limit: 5MB max
18. Health check endpoint: `GET /health`
19. Prometheus metrics: `emails_received_total`, `encryption_errors_total`, `tx_errors_total`, `rpc_duration_seconds`
20. Cache `aliasHash -> contractAddress` and `contractAddress -> emailPublicKey` with 5-minute TTL

## Tasks / Subtasks

- [x] Task 1: Project scaffold (AC: #1, #2)
  - [x] 1.1 Create `services/smtp-bridge/` with `package.json`, `tsconfig.json`, Express + TypeScript boilerplate
  - [x] 1.2 Add pnpm workspace dependency on `@aliasvault/ipfs-service`, `@aliasvault/contract` (no `@aliasvault/config` — contracts.ts is a bare file)
  - [x] 1.3 Create `src/config/env.ts` — environment variable loader with validation (see Dev Notes)
  - [x] 1.4 Create `src/app.ts` — Express app with JSON body parser, CORS, error handler
  - [x] 1.5 Create `src/index.ts` — server startup, wallet init, graceful shutdown

- [x] Task 2: Midnight wallet + provider setup (AC: #2, #3, #4)
  - [x] 2.1 Create `src/midnight/wallet.ts` — `WalletFacade` setup from seed (HDWallet key derivation, ShieldedWallet, UnshieldedWallet, DustWallet)
  - [x] 2.2 Create `src/midnight/providers.ts` — `configureProviders()`: levelPrivateStateProvider, indexerPublicDataProvider, httpClientProofProvider, NodeZkConfigProvider, walletProvider, midnightProvider
  - [x] 2.3 Create `src/midnight/contracts.ts` — deriveRelayCommitment() utility (contract joining deferred to runtime with live network)
  - [x] 2.4 Add `globalThis.WebSocket = WebSocket` polyfill (required for Node.js — no browser WebSocket)
  - [x] 2.5 Derive relay commitment at startup, log it for operator verification

- [x] Task 3: Alias lookup + caching (AC: #6, #7, #8, #20)
  - [x] 3.1 Create `src/services/aliasLookup.ts` — `lookupAlias(aliasHash)`: query AliasRegistry.getContractAddress(), cache result (TTL 5min)
  - [x] 3.2 Create `src/services/emailKeyLookup.ts` — `getEmailPublicKey(contractAddress)`: read VaultRegistry public ledger via indexer, cache result (TTL 5min)
  - [x] 3.3 Alias hashing: re-implement SHA-256(`localPart@domain`) using Node.js crypto — must match `apps/browser-extension/src/utils/aliasUtils.ts`

- [x] Task 4: Email encryption + IPFS storage (AC: #9, #10, #11)
  - [x] 4.1 Create `src/services/emailEncryptor.ts` — X25519 hybrid encryption per ADR-008
  - [x] 4.2 Create `src/services/manifestManager.ts` — read/append/upload inbox manifest to IPFS
  - [x] 4.3 Wire `PinataProvider` from `@aliasvault/ipfs-service` with server-side Pinata JWT config

- [x] Task 5: Notification + batching (AC: #12, #13, #14)
  - [x] 5.1 Create `src/services/notificationQueue.ts` — per-user serialization queue + batch window (30s default)
  - [x] 5.2 Implement `notifyNewMail(manifestCid)` call via VaultRegistry contract with relay key witness
  - [x] 5.3 Handle tx errors: retry with backoff, dead-letter on permanent failure

- [x] Task 6: Webhook endpoint (AC: #5, #6, #15, #16, #17)
  - [x] 6.1 Create `src/routes/email.ts` — `POST /receive-email` route
  - [x] 6.2 Request validation: size limit (5MB), required fields, alias extraction
  - [x] 6.3 Rate limiter middleware: 100 req/min per alias (use `express-rate-limit` with alias key)
  - [x] 6.4 Wire full pipeline: extract alias -> lookup -> encrypt -> IPFS -> queue notification -> respond

- [x] Task 7: Health + metrics (AC: #18, #19)
  - [x] 7.1 Create `src/routes/health.ts` — `GET /health` endpoint (wallet sync status, indexer connectivity)
  - [x] 7.2 Create `src/metrics.ts` — Prometheus counters/histograms via `prom-client`
  - [x] 7.3 Expose `GET /metrics` endpoint

- [x] Task 8: Tests (AC: all)
  - [x] 8.1 Unit tests for `emailEncryptor.ts`: encrypt/decrypt round-trip with tweetnacl
  - [x] 8.2 Unit tests for `manifestManager.ts`: create, append, serialize manifest
  - [x] 8.3 Unit tests for `notificationQueue.ts`: batching, serialization, error handling
  - [x] 8.4 Unit tests for alias hashing: verify output matches `aliasUtils.ts` reference
  - [x] 8.5 Integration test for `POST /receive-email`: mock contract queries + IPFS, verify full pipeline
  - [x] 8.6 Add `vitest` config for `services/smtp-bridge/`

## Dev Notes

### Architecture Overview

The SMTP Bridge is a **server-side Express.js microservice** that acts as a full Midnight client. It receives email webhooks from Mox SMTP server (Story 5.4) and processes them through a privacy-preserving pipeline:

```
Mox SMTP -> POST /receive-email -> Extract alias -> AliasRegistry.getContractAddress()
  -> VaultRegistry.emailPublicKey -> X25519 encrypt -> IPFS upload
  -> Update manifest -> notifyNewMail() on VaultRegistry -> 200 OK
```

### Midnight Server-Side Wallet Setup (CRITICAL)

This is NOT a browser app. No Lace wallet. The bridge operates its own wallet from a seed phrase.

**Required packages (server-side specific):**
```
@midnight-ntwrk/wallet-sdk-facade
@midnight-ntwrk/wallet-sdk-dust-wallet
@midnight-ntwrk/wallet-sdk-hd
@midnight-ntwrk/wallet-sdk-shielded
@midnight-ntwrk/wallet-sdk-unshielded-wallet
@midnight-ntwrk/midnight-js-level-private-state-provider
@midnight-ntwrk/midnight-js-node-zk-config-provider
@midnight-ntwrk/midnight-js-http-client-proof-provider
@midnight-ntwrk/midnight-js-indexer-public-data-provider
@midnight-ntwrk/midnight-js-contracts
@midnight-ntwrk/midnight-js-types
@midnight-ntwrk/midnight-js-network-id
@midnight-ntwrk/midnight-js-utils
@midnight-ntwrk/compact-runtime
@midnight-ntwrk/ledger-v7
ws (WebSocket polyfill for Node.js)
```

**Wallet initialization pattern** (from counter-cli, bboard-cli, midnames-cli — 8+ reference projects confirm):
```typescript
import { HDWallet, Roles, generateRandomSeed } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { UnshieldedWallet, createKeystore, InMemoryTransactionHistoryStorage, PublicKey } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { WebSocket } from 'ws';

// REQUIRED: Polyfill WebSocket for Node.js
globalThis.WebSocket = WebSocket as any;

setNetworkId('preprod'); // or read from env

const hdWallet = HDWallet.fromSeed(seed);
const keys = hdWallet.deriveAllRoles();
const shieldedSecretKeys = { coinSk: keys[Roles.CoinPrivate], encSk: keys[Roles.EncryptionPrivate] };
const dustSecretKey = keys[Roles.DustPrivate];
const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());

const walletConfig = {
  networkId: getNetworkId(),
  indexerClientConnection: { indexerHttpUrl, indexerWsUrl },
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(node.replace(/^http/, 'ws')),
};

const shieldedWallet = ShieldedWallet(walletConfig).startWithSecretKeys(shieldedSecretKeys);
const unshieldedWallet = UnshieldedWallet({
  networkId: getNetworkId(),
  indexerClientConnection: { indexerHttpUrl, indexerWsUrl },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(),
}).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore));
const dustWallet = DustWallet({
  ...walletConfig,
  costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
}).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust);

const wallet = new WalletFacade(shieldedWallet, unshieldedWallet, dustWallet);
await wallet.start(shieldedSecretKeys, dustSecretKey);
```

**Provider configuration pattern** (from counter-cli/midnames-cli):
```typescript
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';

const configureProviders = async (walletAndMidnightProvider, config) => ({
  privateStateProvider: levelPrivateStateProvider({
    privateStateStoreName: 'smtp-bridge-private-state',
    walletProvider: walletAndMidnightProvider,
  }),
  publicDataProvider: indexerPublicDataProvider(config.indexerUrl, config.indexerWsUrl),
  zkConfigProvider: new NodeZkConfigProvider(zkConfigPath),
  proofProvider: httpClientProofProvider(config.proofServerUrl, zkConfigProvider),
  walletProvider: walletAndMidnightProvider,
  midnightProvider: walletAndMidnightProvider,
});
```

**MidnightWalletProvider bridge** (implements both `WalletProvider` and `MidnightProvider`):
```typescript
const createWalletAndMidnightProvider = async (wallet) => ({
  getCoinPublicKey: () => wallet.coinPublicKey,
  getEncryptionPublicKey: () => wallet.encryptionPublicKey,
  balanceTx: (tx, newCoins, ttl) => wallet.balanceTransaction(tx, newCoins, ttl),
  submitTx: (tx) => wallet.submitTransaction(tx),
});
```

### X25519 Encryption (ADR-008)

```typescript
import nacl from 'tweetnacl';

function encryptEmail(emailJson: string, recipientPublicKey: Uint8Array): Uint8Array {
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  const messageBytes = new TextEncoder().encode(emailJson);
  const encrypted = nacl.box(messageBytes, nonce, recipientPublicKey, ephemeral.secretKey);
  // Package: [ephemeralPubKey(32) | nonce(24) | ciphertext]
  const result = new Uint8Array(32 + 24 + encrypted.length);
  result.set(ephemeral.publicKey, 0);
  result.set(nonce, 32);
  result.set(encrypted, 56);
  return result;
}
```

- Ephemeral secret key is discarded after encryption (forward secrecy)
- Email JSON schema: `{ from, to, subject, body, attachments?: [{ name, contentType, base64 }], receivedAt }`
- Use `tweetnacl` (same library as browser extension Story 5.0/5.2)

### Inbox Manifest Format (ADR-009)

```json
{
  "version": 1,
  "emails": [
    { "cid": "bafyrei...", "ts": 1709553600 },
    { "cid": "bafyrei...", "ts": 1709554200 }
  ]
}
```

- **Plaintext** on IPFS (bridge must read to append)
- Contains only opaque CIDs + timestamps — no sender/subject metadata
- Bridge reads current manifest from `inboxManifestCid` on VaultRegistry public ledger, appends, re-uploads
- If no existing manifest (first email), create new one

### Contract Interaction Pattern

**AliasRegistry** (singleton global contract — read-only for bridge):
- `getContractAddress(aliasHash: Bytes<32>)` — returns `Opaque<'string'>` (VaultRegistry address)
- `getOwner(aliasHash: Bytes<32>)` — returns `Bytes<32>` (owner commitment, zero if unclaimed)
- Bridge only needs read access — join contract without write witness

**VaultRegistry** (per-user contract — bridge reads public ledger + calls `notifyNewMail`):
- Read `emailPublicKey` from public ledger via indexer (no circuit call needed)
- `notifyNewMail(manifestCid: Opaque<'string'>)` — relay-only circuit, requires `local_relay_key()` witness
- Bridge must join each user's VaultRegistry with relay key in private state to call `notifyNewMail`

**Relay authorization:**
- Bridge's relay secret key: 32-byte random value stored in `RELAY_SECRET_KEY` env var
- Relay commitment: `persistentCommit<Bytes<32>>(pad(32, "vault:relay:"), relayKey)` — domain separator `"vault:relay:"`
- Users authorize bridge by calling `setMailRelay(bridgeRelayCommitment)` from their extension (Story 5.2)
- Bridge proves relay identity via `local_relay_key()` witness when calling `notifyNewMail()`

### Alias Hashing (MUST Match Browser Extension)

Both bridge and extension hash: `SHA-256("localPart@domain")` → `Bytes<32>`

Reference: `apps/browser-extension/src/utils/aliasUtils.ts`
```typescript
export const ALIAS_DOMAIN = 'alias.id';

export async function hashAlias(aliasName: string): Promise<Uint8Array> {
  const fullAddress = `${aliasName}@${ALIAS_DOMAIN}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(fullAddress);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hashBuffer);
}
```

For Node.js server, use `crypto.createHash('sha256')` instead of `crypto.subtle.digest`.

### Environment Variables

```
# Midnight Network
MIDNIGHT_NETWORK_ID=preprod
INDEXER_URL=https://indexer.preview.midnight.network/api/v3/graphql
INDEXER_WS_URL=wss://indexer.preview.midnight.network/api/v3/graphql/ws
PROOF_SERVER_URL=http://localhost:6300
NODE_URL=http://localhost:9944

# Wallet
WALLET_SEED=<64-char-hex-seed>

# Relay
RELAY_SECRET_KEY=<64-char-hex-relay-key>

# IPFS / Pinata
PINATA_JWT=<jwt-token>
PINATA_GATEWAY=<gateway-domain>

# Webhook Auth
BRIDGE_WEBHOOK_SECRET=<bearer-token-for-mox>

# Service
PORT=3000
BATCH_WINDOW_MS=30000
RATE_LIMIT_PER_ALIAS=100

# Contract Addresses (from shared/config/contracts.ts)
VAULT_REGISTRY_ZK_CONFIG_PATH=./dist/managed/vault-registry
ALIAS_REGISTRY_ADDRESS=<deployed-address>
```

### Reuse Existing Code

| What | Where | How |
|------|-------|-----|
| IPFS upload/download | `shared/ipfs-service/` | `PinataProvider` + `IpfsService` — use as workspace dep |
| Contract addresses | `shared/config/contracts.ts` | Import `CONTRACT_ADDRESSES` |
| Alias domain constant | `apps/browser-extension/src/utils/aliasUtils.ts` | Copy `ALIAS_DOMAIN = 'alias.id'` to shared constant or duplicate in bridge |
| IpfsError patterns | `shared/ipfs-service/src/errors.ts` | Reuse error codes |
| CID validation | `packages/blockchain/contract/src/cid-utils.ts` | Import `assertCIDv1()` |
| Contract types | `@aliasvault/contract` | Import VaultRegistry, AliasRegistry types |

### DO NOT

- Do NOT use `inMemoryPrivateStateProvider` — use `levelPrivateStateProvider` for persistence across restarts
- Do NOT use `FetchZkConfigProvider` — that's browser-only. Use `NodeZkConfigProvider`
- Do NOT use Lace wallet or `window.midnight` — this is a headless Node.js service
- Do NOT store sender metadata in the manifest — only CID + timestamp (privacy)
- Do NOT import from browser extension source files — copy or share via `shared/` packages
- Do NOT use `crypto.subtle` for SHA-256 in Node.js — use `crypto.createHash('sha256')`
- Do NOT skip `globalThis.WebSocket = WebSocket` polyfill — wallet SDK requires it

### Project Structure Notes

```
services/smtp-bridge/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                  # Entry: init wallet, start server
    app.ts                    # Express app config
    config/
      env.ts                  # Environment variable loader
    midnight/
      wallet.ts               # WalletFacade from seed
      providers.ts             # 6-provider config
      contracts.ts             # Join VaultRegistry + AliasRegistry
    services/
      aliasLookup.ts           # AliasRegistry queries + cache
      emailKeyLookup.ts        # VaultRegistry public key reads + cache
      emailEncryptor.ts        # X25519 hybrid encryption (ADR-008)
      manifestManager.ts       # IPFS manifest read/append/upload
      notificationQueue.ts     # Per-user batched notifyNewMail
    routes/
      email.ts                 # POST /receive-email
      health.ts                # GET /health
    metrics.ts                 # Prometheus prom-client
    types/
      email.ts                 # Email type definitions
    __tests__/
      emailEncryptor.test.ts
      manifestManager.test.ts
      notificationQueue.test.ts
      aliasHashing.test.ts
      receiveEmail.integration.test.ts
```

This service is in `services/*` which IS in `pnpm-workspace.yaml` — can use `workspace:*` dependencies on `shared/*` and `packages/*`.

### Previous Story Learnings

**From Story 5.0 (contract):**
- Relay commitment pattern uses `persistentCommit` with domain separator `"vault:relay:"`
- `notifyNewMail` asserts `mailRelay == relayCommitment(local_relay_key())` — bridge must provide `local_relay_key` witness
- Email state (emailPublicKey, emailCount, inboxManifestCid, mailRelay) reset during `transferOwnership`/`backupTransfer`
- `inboxManifestCid` is `Opaque<'string'>` — initialized empty before first email

**From Story 5.1 (AliasRegistry):**
- AliasRegistry is a **singleton global contract** — one instance for all users
- `getContractAddress()` returns `Opaque<'string'>` which maps to string in TypeScript
- `getOwner()` returns `Bytes<32>` — zero bytes if alias unclaimed
- Map `lookup()` throws for non-existent keys in simulator — check with `member()` first, or catch

**From Story 5.2 (UI):**
- Bridge relay commitment configured in `apps/browser-extension/src/config/bridge.ts` — MVP uses zero bytes placeholder
- Extension calls `setMailRelay(bridgeRelayCommitment)` on first alias claim — this is what authorizes the bridge
- Alias hashing: `SHA-256("aliasName@alias.id")` — bridge MUST use identical algorithm
- `tweetnacl` used for X25519 — use same library in bridge for encryption compatibility

### Git Intelligence

Recent commits show Epic 5 stories (5.0, 5.1, 5.2) followed a pattern of:
- Contract work in `packages/blockchain/contract/`
- Service code in `apps/browser-extension/src/services/`
- Shared config in `shared/config/`
- Sprint status updates after each story

### Testing Strategy

- **Unit tests**: Mock all external dependencies (contract queries, IPFS, wallet)
- **emailEncryptor**: Round-trip test — encrypt with public key, decrypt with private key using `tweetnacl`
- **manifestManager**: Test create/append/serialize without IPFS (mock upload)
- **notificationQueue**: Test batching timer, serialization, error handling with fake timers
- **aliasHashing**: Verify bridge hash matches browser extension hash for same input
- **Integration**: Supertest against Express app with all externals mocked
- **DO NOT test on-chain** — contract circuit tests already covered in Story 5.0/5.1. Bridge tests mock contract calls.
- **Framework**: `vitest` (consistent with rest of project)

### References

- [Source: docs/architecture/adr-008-email-encryption-x25519.md] — Full encryption algorithm
- [Source: docs/architecture/adr-009-email-notification-on-chain.md] — Relay authorization, manifest format, notification flow
- [Source: packages/blockchain/contract/src/vault-registry.compact] — notifyNewMail, setMailRelay, relayCommitment circuits
- [Source: packages/blockchain/contract/src/alias-registry.compact] — getContractAddress, getOwner circuits
- [Source: apps/browser-extension/src/utils/aliasUtils.ts] — hashAlias reference implementation
- [Source: apps/browser-extension/src/config/bridge.ts] — Bridge relay commitment constant
- [Source: shared/ipfs-service/] — IpfsService, PinataProvider, IpfsError patterns
- [Source: shared/config/contracts.ts] — Contract address configuration
- [Source: midnightntwrk/example-counter/counter-cli/src/api.ts] — Server-side wallet + provider setup pattern
- [Source: midnightntwrk/example-bboard/bboard-cli/src/index.ts] — CLI wallet initialization
- [Source: midnames/core/midnames-cli/src/api.ts] — Alternative server-side provider config

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- Midnight wallet SDK packages at v1.0.0 (facade, dust, shielded, unshielded), HD at v3.0.0, JS middleware at 3.0.0-3.1.0
- No `@aliasvault/config` workspace package exists — `shared/config/contracts.ts` is a bare file; dropped from deps
- Contract joining with `findDeployedContract()` deferred to runtime (requires live Midnight network); `deriveRelayCommitment()` implemented for operator verification logging

### Code Review Fixes Applied
- **H1 (contract wiring)**: `contracts.ts` expanded from single utility to full contract interaction layer — indexer reads (`lookupAliasVaultAddress`, `readEmailPublicKeyFromIndexer`, `readInboxManifestCidFromIndexer`) + contract join for relay (`getOrJoinVaultRegistryForRelay`, `callNotifyNewMail`). `index.ts` now calls `configureProviders()`, wires `setQueryFn()` / `setNotifyFn()` with real contract functions. Added `@midnight-ntwrk/compact-js@2.4.0` dependency.
- **H2 (webhook auth)**: Added `webhookAuth()` Bearer token middleware to `POST /receive-email` — validates `Authorization: Bearer <BRIDGE_WEBHOOK_SECRET>`. Returns 401 (missing) or 403 (wrong secret). 2 new tests cover enforcement.
- **H3 (manifest CID)**: Route now reads existing `inboxManifestCid` from VaultRegistry public ledger via indexer before appending, instead of always passing `null`. Added `readInboxManifestCid` to `BridgeContext`. 1 new test verifies CID is passed through.
- **M1 (dead import)**: Removed unused `emailsReceived` import from `notificationQueue.ts`.
- **M2 (no-op middleware)**: Removed `metricsMiddleware` (was a no-op `next()` call) from `metrics.ts` and `app.ts`.
- **M3 (CORS removal)**: Removed unused `cors` middleware and `@types/cors` devDependency — server-to-server webhook service doesn't need CORS.
- **M4 (health check indexer connectivity)**: Health endpoint now calls `ctx.checkIndexerHealth()` for real indexer ping. Returns `status: 'ok'|'degraded'` based on wallet + indexer health. Added 2 new health tests.
- **Dead import cleanup**: Removed unused `EnvConfig` type import from `contracts.ts` after rewrite.
- **Tests**: 45 tests across 5 files (up from 41). Added: webhook auth 401/403 enforcement (2 tests), manifest CID indexer read verification (1 test), health check with indexer status (1 test).

### Completion Notes List
- Task 1: Full Express+TS scaffold with env validation, JSON body parser (5MB limit), CORS, error handler, graceful shutdown
- Task 2: WalletFacade init from HD seed, 6-provider config (level private state, node ZK config, http proof, indexer public data), WebSocket polyfill, relay commitment derivation at startup. Providers now called and wired in index.ts.
- Task 3: AliasLookupService + EmailKeyLookupService with 5-min TTL caches, pluggable query functions wired to real indexer reads via `lookupAliasVaultAddress()` and `readEmailPublicKeyFromIndexer()`. Node.js hashAlias() using `crypto.createHash('sha256')` — matches browser extension's `crypto.subtle.digest`
- Task 4: X25519 hybrid encryption per ADR-008 (ephemeral keypair, nacl.box, [pubKey|nonce|ciphertext] format). ManifestManager handles create/append/serialize/upload of plaintext inbox manifests (CID+ts only, no metadata)
- Task 5: NotificationQueue with per-contract serialization, configurable batch window (default 30s), retry with exponential backoff (3 attempts), dead-letter logging. `notifyFn` wired to `callNotifyNewMail()` which joins VaultRegistry per-user with relay key.
- Task 6: POST /receive-email endpoint with webhook Bearer auth, field validation, size limit, alias extraction (handles "Name <addr>" format), per-alias rate limiting, indexer manifest CID read, full pipeline wiring
- Task 7: GET /health (wallet status), Prometheus metrics (emails_received_total, encryption_errors_total, tx_errors_total, rpc_duration_seconds), GET /metrics endpoint
- Task 8: 45 tests across 5 files — all passing. emailEncryptor (7), manifestManager (12), notificationQueue (6), aliasHashing (7), integration (13: success flow, encryption, manifest CID read, notification queueing, auth enforcement 401/403, validation errors, 404s, health check ok/degraded, address formats)

### File List
- services/smtp-bridge/package.json (new)
- services/smtp-bridge/tsconfig.json (new)
- services/smtp-bridge/vitest.config.ts (new)
- services/smtp-bridge/src/index.ts (new)
- services/smtp-bridge/src/app.ts (new)
- services/smtp-bridge/src/metrics.ts (new)
- services/smtp-bridge/src/config/env.ts (new)
- services/smtp-bridge/src/midnight/wallet.ts (new)
- services/smtp-bridge/src/midnight/providers.ts (new)
- services/smtp-bridge/src/midnight/contracts.ts (new)
- services/smtp-bridge/src/services/aliasLookup.ts (new)
- services/smtp-bridge/src/services/emailKeyLookup.ts (new)
- services/smtp-bridge/src/services/aliasHashing.ts (new)
- services/smtp-bridge/src/services/emailEncryptor.ts (new)
- services/smtp-bridge/src/services/manifestManager.ts (new)
- services/smtp-bridge/src/services/notificationQueue.ts (new)
- services/smtp-bridge/src/routes/email.ts (new)
- services/smtp-bridge/src/routes/health.ts (new)
- services/smtp-bridge/src/types/context.ts (new)
- services/smtp-bridge/src/types/email.ts (new)
- services/smtp-bridge/src/__tests__/emailEncryptor.test.ts (new)
- services/smtp-bridge/src/__tests__/manifestManager.test.ts (new)
- services/smtp-bridge/src/__tests__/notificationQueue.test.ts (new)
- services/smtp-bridge/src/__tests__/aliasHashing.test.ts (new)
- services/smtp-bridge/src/__tests__/receiveEmail.integration.test.ts (new)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)
- pnpm-lock.yaml (modified)
