# Testnet Deployment & Integration Testing Research

> **Date:** 2026-03-10
> **Author:** Winston (Architect) + Ozi3o
> **Context:** Epic 5 complete (Stories 5.0-5.7 done/reviewed, 5.8 deferred). All application code is built. This document captures evidence-based findings for deploying to Midnight preprod and establishing integration testing.

---

## 1. Midnight Network Status & Timeline

### Mainnet Launch
- **Confirmed: final week of March 2026** (weeks away)
- Announced by Charles Hoskinson at Consensus HK
- Sources: [Consensus HK Recap](https://midnight.network/blog/consensus-hk-2026-recap), [CoinDesk coverage](https://www.coindesk.com/markets/2026/02/12/charles-hoskinson-announces-late-march-debut-for-privacy-focused-midnight-blockchain-and-unveils-privacy-simulation-platform)

### Current SDK Versions (Compatibility v1.0)
Last updated per [Release Overview](https://docs.midnight.network/relnotes/overview) (March 3, 2026):

| Component | Latest Stable | Our Version | Gap |
|-----------|--------------|-------------|-----|
| Compact Compiler | 0.29.0 | 0.28.x (likely) | Minor — run `compact update` |
| Midnight.js | 3.1.0 | 3.0.0 (CLI/contract), 3.1.0 (bridge) | CLI needs bump |
| Wallet SDK | 1.0.0 | 1.0.0 | Aligned |
| Proof Server | 7.0.0 | 7.0.0 | Aligned |
| Node | 0.21.0 | 0.20.0 (standalone.yml) | Minor — Docker tag bump |
| Indexer | 3.1.0 | 3.0.0 (standalone.yml) | Minor — Docker tag bump |
| Compact Runtime | 0.14.0 | 0.14.0 | Aligned |
| Ledger | 7.0.0 | 7.0.0 | Aligned |
| DApp Connector API | 4.0.0 | v4+ (Lace) | Aligned |

**Package locations in our codebase:**
- `packages/blockchain/package.json` — midnight-js 3.0.0
- `services/smtp-bridge/package.json` — midnight-js 3.1.0
- `packages/blockchain/cli/standalone.yml` — node 0.20.0, indexer 3.0.0
- `packages/blockchain/cli/proof-server.yml` — proof-server 7.0.0

### Network Naming Transition (Warning)
Midnight is transitioning network naming in newer tooling ([Forum Discussion](https://forum.midnight.network/t/confusion-around-create-mn-app-network-naming-changes-and-faucet-access/1071)):

| Old (our codebase) | New (`create-mn-app@latest`) |
|--------------------|----------------------------|
| `undeployed` | `undeployed` |
| `preview` | (deprecated) |
| `preprod` | `testnet` |
| — | `mainnet` |

Our codebase uses the **older naming**, which still works. The preprod faucet is confirmed functional. Monitor for breaking changes as mainnet approaches.

---

## 2. Preprod Network Endpoints (Verified)

All endpoints verified against [Midnight official docs](https://docs.midnight.network/guides/deploy-mn-app), our existing `PreprodConfig` class, and the guardian portal network config.

| Service | URL | Notes |
|---------|-----|-------|
| Indexer GraphQL | `https://indexer.preprod.midnight.network/api/v3/graphql` | HTTP |
| Indexer WebSocket | `wss://indexer.preprod.midnight.network/api/v3/graphql/ws` | Subscriptions |
| Node RPC | `https://rpc.preprod.midnight.network` | Transaction submission |
| Faucet | `https://faucet.preprod.midnight.network/` | tDUST tokens (no real value) |
| Proof Server | `http://localhost:6300` (local Docker only) | See note below |

### Proof Server: Local Only
**Critical finding:** Midnight documentation only documents local proof servers. There is no confirmed hosted/public proof server for server-side use.

- **Browser (Lace wallet):** Lace has its own proving provider. Our extension reads the proof server URL from Lace's `ConnectedAPI` at runtime — this works without a local proof server.
- **Server-side (CLI, SMTP bridge):** Must run `docker run -p 6300:6300 midnightntwrk/proof-server:7.0.0 -- midnight-proof-server -v` locally alongside the service.
- **Our guardian portal config** has `https://proof.preprod.midnight.network` but this URL is **unconfirmed in official docs**. The portal reads the proof server URL from Lace at runtime anyway, so it's moot.

### Other Networks (from guardian portal config)

| Network | Indexer | Node | Proof Server |
|---------|---------|------|--------------|
| preview | `https://indexer.preview.midnight.network/api/v3/graphql` | `https://rpc.preview.midnight.network` | `https://proof.preview.midnight.network` (unconfirmed) |
| qanet | `https://indexer.qanet.midnight.network/api/v3/graphql` | `https://rpc.qanet.midnight.network` | `https://proof.qanet.midnight.network` (unconfirmed) |
| mainnet | `https://indexer.midnight.network/api/v3/graphql` | `https://rpc.midnight.network` | `https://proof.midnight.network` (unconfirmed) |

---

## 3. What We Already Have (Codebase Inventory)

### 3.1 Deployment Scripts (Ready)

| Script | Location | Command | Status |
|--------|----------|---------|--------|
| Deploy VaultRegistry (local) | `packages/blockchain/cli` | `pnpm run deploy-local` | Working |
| Deploy VaultRegistry (preview) | `packages/blockchain/cli` | `pnpm run deploy-preview -- --seed=<hex>` | Ready |
| Deploy VaultRegistry (preprod) | `packages/blockchain/cli` | `pnpm run deploy-preprod -- --seed=<hex>` | Ready |
| Start proof server | `packages/blockchain/cli` | `pnpm run preprod-ps` | Ready |
| Interactive TUI | `packages/blockchain/cli` | `pnpm run vault-registry` | Working |

**Deploy script features** (`src/deploy-vault-registry.ts`):
- `--network=local|preview|preprod` flag
- `--seed=<hex>` for wallet (required for preview/preprod, auto-uses genesis for local)
- `--dry-run` to skip writing contract address
- Deterministic secret key: `SHA256(seed + ':aliasvault:vault-registry:owner')`
- Auto-updates `shared/config/contracts.ts` with deployed address
- Outputs raw address on final line (CI/CD friendly)

### 3.2 Network Configurations (Per Component)

| Component | Config Location | Multi-Network | Status |
|-----------|----------------|---------------|--------|
| CLI | `packages/blockchain/cli/src/config.ts` | `StandaloneConfig`, `PreviewConfig`, `PreprodConfig` | Ready |
| Guardian Portal | `services/guardian-portal/src/config/networkConfig.ts` | All 5 networks in `NETWORK_CONFIGS` map + `getNetworkConfig()` | Ready (change `CURRENT_NETWORK`) |
| SMTP Bridge | `services/smtp-bridge/src/config/env.ts` | Env-var driven — no code changes needed | Ready |
| Browser Extension | `apps/browser-extension/src/entrypoints/popup/config/networkConfig.ts` | **Hardcoded to localhost** | Needs work |

### 3.3 Local Chain Infrastructure (Ready)

**Docker Compose** (`packages/blockchain/cli/standalone.yml`):
- Proof Server: `midnightntwrk/proof-server:7.0.0` (port 6300)
- Indexer: `midnightntwrk/indexer-standalone:3.0.0` (port 8088)
- Node: `midnightntwrk/midnight-node:0.20.0` (port 9944)
- All with health checks, indexer depends on node

**Testcontainers integration** (`packages/blockchain/cli/src/standalone.ts`):
- `DockerComposeEnvironment` from `testcontainers`
- Wait strategies for proof-server and indexer log messages
- Used by `pnpm run test-api` for automated integration tests

**Alternative:** [Brick Towers `midnight-local-network`](https://github.com/bricktowers/midnight-local-network) v3.0.0 matches our SDK (node 0.20.1, indexer 3.0.0, proof-server 7.0.0). Includes wallet funding scripts.

### 3.4 Contract Artifacts (Compiled & Ready)

| Contract | Compact Source | Managed Output | Deploy Script | Address in Config |
|----------|---------------|----------------|---------------|-------------------|
| VaultRegistry | `packages/blockchain/contract/src/vault-registry.compact` | `src/managed/vault-registry/` | `deploy-vault-registry.ts` | `e386083d...` (local) |
| AliasRegistry | `packages/blockchain/contract/src/alias-registry.compact` | `src/managed/alias-registry/` | **Missing** | Empty string |
| GuardianRecovery | `packages/blockchain/contract/src/guardian-recovery.compact` | `src/managed/guardian-recovery/` | **Missing** | Not in config |

### 3.5 SMTP Pipeline Infrastructure

| Component | Location | Docker | Config |
|-----------|----------|--------|--------|
| Mox SMTP Server | `services/mox/` | `docker-compose.mox.yml` (host networking) | `config/mox.conf`, `config/domains.conf.template` |
| SMTP Bridge | `services/smtp-bridge/` | `Dockerfile` (multi-stage node:20-alpine) | `src/config/env.ts` (all env vars) |
| Env template | `services/mox/.env.example` | — | Preprod endpoints pre-filled |

**Mox specifics:**
- Domain: `mail.alias.id`
- Webhook: `http://localhost:3000/mox-webhook` (Bearer auth via `${BRIDGE_WEBHOOK_SECRET}`)
- DNS records documented in `services/mox/DNS-RECORDS.md`
- IMAP/IMAPS disabled (security: force email through bridge pipeline)
- `entrypoint.sh` uses `sed` for env var substitution (not `envsubst`)

### 3.6 Existing Tests

**Unit/mock tests** (all passing):
- `packages/blockchain/cli/src/test/vault-registry-api.test.ts` — CID store, circuit call mocks
- `packages/blockchain/cli/src/test/deploy-utils.test.ts` — key derivation, arg parsing
- `packages/blockchain/cli/src/test/guardian-recovery-api.test.ts` — recovery circuit mocks
- `services/smtp-bridge/` — 45 tests (Story 5.3)
- `apps/browser-extension/src/services/__tests__/` — EmailDecryptionService, InboxService, EmailCacheService, emailAlarmPolling (Story 5.7)
- `apps/browser-extension/src/hooks/__tests__/` — useEmailSubscription (Story 5.7)

**Integration tests** (testcontainers):
- `packages/blockchain/cli/src/test/counter.api.test.ts` — runs against local Docker chain

---

## 4. Identified Gaps

### 4.1 High Priority (Blocks Testnet Deployment)

| Gap | Description | Effort | Dependency |
|-----|-------------|--------|------------|
| **Browser extension network config** | Hardcoded to `localhost` — no multi-network support. Port the guardian portal pattern: `NETWORK_CONFIGS` map + `getNetworkConfig()` + build-time `CURRENT_NETWORK` | Medium | None |
| **AliasRegistry deploy script** | Contract compiled but no deploy script. Clone `deploy-vault-registry.ts` pattern, update `shared/config/contracts.ts` AliasRegistry block | Low | None |
| **Contract addresses per-network** | `shared/config/contracts.ts` has one address set. Need per-network addresses or environment-based selection | Low | Deploy scripts |

### 4.2 Medium Priority (Blocks Full Pipeline Testing)

| Gap | Description | Effort | Dependency |
|-----|-------------|--------|------------|
| **GuardianRecovery deploy script** | Contract compiled but no deploy script. Same pattern as VaultRegistry | Low | None |
| **Email pipeline integration test** | No automated end-to-end test for the full flow: Mox webhook -> bridge -> encrypt -> IPFS -> contract -> extension | Medium-High | Deploy scripts + Docker harness |
| **SDK version alignment** | CLI midnight-js 3.0.0 should bump to 3.1.0 to match bridge. Compact compiler 0.28.x -> 0.29.0 | Low | None |

### 4.3 Low Priority (Pre-Mainnet Polish)

| Gap | Description | Effort | Dependency |
|-----|-------------|--------|------------|
| **Docker tag bumps** | standalone.yml node 0.20.0 -> 0.21.0, indexer 3.0.0 -> 3.1.0 | Trivial | None |
| **Mox DNS setup** | Need actual DNS records for `alias.id` on production server | Ops task | Server provisioning |
| **CI/CD contract deployment** | Deploy scripts output raw address — can be piped into CI | Medium | Deploy scripts working |

---

## 5. Deployment Sequence (Recommended)

### Phase 1: Configuration

1. Port guardian portal's `networkConfig.ts` to browser extension
2. Create AliasRegistry deploy script (clone VaultRegistry pattern)
3. Run `compact update` to 0.29.0
4. Bump midnight-js to 3.1.0 in `packages/blockchain/package.json`
5. Bump Docker tags in `standalone.yml` (node 0.21.0, indexer 3.1.0)

### Phase 2: Local Validation

1. Run local chain: `docker compose -f standalone.yml up -d`
2. Deploy both contracts locally: `pnpm run deploy-local`
3. Run existing test suite: `pnpm run test-api`
4. Build extension targeting `undeployed`, test vault + email flow manually

### Phase 3: Preprod Deployment

1. Start local proof server: `pnpm run preprod-ps`
2. Fund Lace wallet via [faucet](https://faucet.preprod.midnight.network/)
3. Deploy VaultRegistry: `pnpm run deploy-preprod -- --seed=<hex>`
4. Deploy AliasRegistry: `pnpm run deploy-alias-preprod -- --seed=<hex>`
5. Note deployed addresses (auto-written to `shared/config/contracts.ts`)

### Phase 4: Smoke Testing on Preprod

1. Build extension with `CURRENT_NETWORK=preprod`
2. Connect Lace wallet (preprod network) -> sign challenge -> create vault
3. Create credential -> save -> verify IPFS upload + contract CID update
4. Generate alias -> verify AliasRegistry entry
5. Deploy Mox + bridge on server with DNS for `alias.id`
6. Send test email -> verify bridge processes -> email appears in inbox
7. Test guardian recovery flow via guardian portal

### Phase 5: Integration Test Harness (Post-Smoke)

Build automated Docker Compose test that wires:
- Local Midnight chain (standalone.yml)
- SMTP bridge (with env vars pointing to local chain)
- Mox (or mock webhook sender)
- Test script: send email -> verify IPFS pin -> verify contract state -> verify decryption

---

## 6. Testing Strategy: Where to Test What

| Test Type | Environment | Rationale |
|-----------|-------------|-----------|
| Contract circuits (updateVault, notifyNewMail, etc.) | Local chain | Fast iteration, no faucet dependency, deterministic |
| Contract deployment | Local first, then preprod once | Proof generation takes 30-60s on preprod |
| Wallet connection (Lace) | Preprod | Lace can't connect to local `undeployed` network easily |
| Browser extension E2E | Preprod | Real Lace wallet + real indexer + real transactions |
| SMTP bridge pipeline | Local | No DNS/MX complexity, mock webhook |
| Guardian portal recovery | Preprod | Needs real wallet signatures from two parties |
| Mox email delivery | Production server | Requires DNS, MX records, TLS certificates |

---

## 7. Midnight MCP Server

Available at `npx -y midnight-mcp@latest` — [29 tools](https://dev.to/devsofmidnight/midnight-mcp-ai-assisted-development-for-compact-smart-contracts-37i) for AI-assisted Compact development.

### Relevant Tools for Our Phase

| Tool | Use Case |
|------|----------|
| `midnight-compile-contract` | Validate Compact contracts against real compiler before testnet deploy |
| `midnight-analyze-contract` | 15 static security checks on VaultRegistry + AliasRegistry |
| `midnight-review-contract` | AI-powered security audit before production |
| `midnight-upgrade-check` | Detect breaking changes when bumping SDK versions |
| `midnight-get-migration-guide` | Step-by-step upgrade instructions for version bumps |
| `midnight-search-typescript` | Find deployment patterns across 102 indexed repos |
| `midnight-fetch-docs` | Query live docs for API changes |

### Configuration for Claude Code

Add to MCP server config:
```json
{
  "mcpServers": {
    "midnight": {
      "command": "npx",
      "args": ["-y", "midnight-mcp@latest"]
    }
  }
}
```

### Recommended Pre-Deploy Workflow

1. Run `midnight-analyze-contract` on both VaultRegistry and AliasRegistry source
2. Run `midnight-review-contract` for security audit
3. Run `midnight-upgrade-check` to validate SDK version bumps
4. Use `midnight-compile-contract` to verify contracts compile with Compact 0.29.0

---

## 8. Key Reference Files (Quick Access)

| Purpose | Path |
|---------|------|
| Contract addresses | `shared/config/contracts.ts` |
| CLI network configs | `packages/blockchain/cli/src/config.ts` |
| Extension network config | `apps/browser-extension/src/entrypoints/popup/config/networkConfig.ts` |
| Guardian portal network config | `services/guardian-portal/src/config/networkConfig.ts` |
| Bridge env config | `services/smtp-bridge/src/config/env.ts` |
| Deploy VaultRegistry | `packages/blockchain/cli/src/deploy-vault-registry.ts` |
| Deploy utilities | `packages/blockchain/cli/src/deploy-utils.ts` |
| Local chain Docker | `packages/blockchain/cli/standalone.yml` |
| Proof server Docker | `packages/blockchain/cli/proof-server.yml` |
| Mox Docker Compose | `services/mox/docker-compose.mox.yml` |
| Mox env template | `services/mox/.env.example` |
| Mox DNS records | `services/mox/DNS-RECORDS.md` |
| Bridge Dockerfile | `services/smtp-bridge/Dockerfile` |
| Testcontainers setup | `packages/blockchain/cli/src/standalone.ts` |

---

## 9. External Resources

- [Deploy guide (official)](https://docs.midnight.network/guides/deploy-mn-app)
- [Installation / proof server setup](https://docs.midnight.network/getting-started/installation)
- [Lace wallet guide](https://docs.midnight.network/guides/lace-wallet)
- [Release overview (version matrix)](https://docs.midnight.network/relnotes/overview)
- [Preprod announcement (forum)](https://forum.midnight.network/t/preprod-is-live-updated-packages-examples-tooling/1040)
- [Brick Towers local network](https://github.com/bricktowers/midnight-local-network)
- [Midnight MCP](https://dev.to/devsofmidnight/midnight-mcp-ai-assisted-development-for-compact-smart-contracts-37i)
- [Mainnet announcement](https://midnight.network/blog/consensus-hk-2026-recap)
- [Network naming transition (forum)](https://forum.midnight.network/t/confusion-around-create-mn-app-network-naming-changes-and-faucet-access/1071)
- [Preprod faucet](https://faucet.preprod.midnight.network/)
