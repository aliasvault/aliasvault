# AliasVault Blockchain Package

Midnight smart contract development for AliasVault, based on the official [midnightntwrk/example-counter](https://github.com/midnightntwrk/example-counter) (v2.0.2).

## SDK Versions

| Component | Version |
|-----------|---------|
| Compact CLI | `0.4.0` (language `>= 0.20`) |
| compact-runtime | `0.14.0` |
| midnight-js | `3.0.0` |
| ledger-v7 | `7.0.0` |
| wallet-sdk | `1.0.0` (stable) |

## Prerequisites

1. **Docker** — for running [bricktowers/midnight-local-network](https://github.com/bricktowers/midnight-local-network)
2. **Compact Compiler v0.4.0** — install in WSL:
   ```bash
   curl --proto '=https' --tlsv1.2 -LsSf \
     https://github.com/midnightntwrk/compact/releases/download/compact-v0.4.0/compact-installer.sh | sh
   ```
3. **Node.js v22+**
4. **Lace Wallet** — configured for Undeployed network

## Quick Start

```bash
# From packages/blockchain/

# 1. Install dependencies
npm install

# 2. Compile the Compact contracts (in WSL)
cd contract
compact compile src/counter.compact src/managed/counter
compact compile src/vault-registry.compact src/managed/vault-registry
cd ..

# 3. Build TypeScript (in WSL for rm/cp commands)
wsl bash -lc "cd contract && rm -rf dist && npx tsc --project tsconfig.build.json && cp -Rf ./src/managed ./dist/managed && cp ./src/counter.compact ./dist/ && cp ./src/vault-registry.compact ./dist/"
wsl bash -lc "cd cli && rm -rf dist && npx tsc --project tsconfig.build.json"

# 4. Start local Midnight network (in another terminal)
# cd ~/projects/midnight-local-network && docker compose up

# 5. Run the Counter TUI (connects to already-running local network)
cd cli
node --experimental-specifier-resolution=node --loader ts-node/esm src/tui_local.ts

# Or run the VaultRegistry test TUI
node --experimental-specifier-resolution=node --loader ts-node/esm src/tui_vault_registry.ts
```

## Structure

```
packages/blockchain/
├── contract/                  # Compact smart contracts + TypeScript bindings
│   ├── src/
│   │   ├── counter.compact         # Counter contract (starter example)
│   │   ├── vault-registry.compact  # VaultRegistry contract (vault registration)
│   │   ├── managed/                # Compiled contract artifacts (auto-generated)
│   │   │   ├── counter/            # Counter compiled output
│   │   │   └── vault-registry/     # VaultRegistry compiled output
│   │   ├── witnesses.ts            # Witness functions
│   │   └── index.ts                # Contract exports (Counter + VaultRegistry)
│   └── package.json
├── cli/                       # CLI tools for contract deployment & interaction
│   ├── src/
│   │   ├── api.ts                    # Counter contract interaction API
│   │   ├── vault-registry-api.ts     # VaultRegistry contract interaction API
│   │   ├── vault-registry-types.ts   # VaultRegistry TypeScript types
│   │   ├── deploy-vault-registry.ts  # Headless VaultRegistry deployment script
│   │   ├── deploy-utils.ts           # Deploy utilities (secret key, config update, arg parsing)
│   │   ├── cli.ts                    # Interactive TUI menus (counter)
│   │   ├── config.ts                 # Network configurations
│   │   ├── tui_local.ts             # Counter TUI (direct-connect, no Docker)
│   │   ├── tui_vault_registry.ts    # VaultRegistry test TUI
│   │   ├── standalone.ts            # Entry point that starts its own Docker containers
│   │   └── test/
│   │       ├── deploy-utils.test.ts  # Deploy utility unit tests
│   │       └── vault-registry-api.test.ts
│   └── package.json
└── package.json               # Workspace root
```

## Contracts

### Counter (starter example)
Simple counter contract from the Midnight example-counter template. Used for SDK integration testing.

### VaultRegistry (Story 2.1 — Private State)
Vault registration contract with **private state** for CID storage and **owner access control**.

- **Public ledger**: `registrations: Set<Bytes<32>>`, `totalVaults: Counter`, `owner: Bytes<32>`, `vaultCidHash: Bytes<32>`
- **Private state** (off-chain): `secretKey` only — accessed via `local_secret_key()` witness
- **Application-layer CID**: Full CID stored in TypeScript `Map`; on-chain `vaultCidHash` holds SHA-256 for integrity
- **Circuits**:
  - `registerVault(walletAddressHash)` — registers vault, sets owner commitment
  - `updateVault(newCidHash)` — owner-only, updates CID hash on-chain
  - `isRegistered(walletAddressHash)` — checks registration
  - `ownerCommitment(sk)` — pure circuit, derives hiding commitment via `persistentCommit`
- **Owner identity**: `persistentCommit` with fixed domain separator (OpenZeppelin ZOwnablePK pattern)
- **CIDv1 enforcement**: `assertCIDv1()` in `contract/src/cid-utils.ts` (canonical), re-exported via CLI
- **Tests**: 13 contract unit tests (simulator) + 6 API-layer CID store tests

**Run test TUI:** `npm run vault-registry` (from `packages/blockchain/`)

## Deployment

Deploy the VaultRegistry contract to a target network and automatically update `shared/config/contracts.ts` with the deployed address.

### Prerequisites per Network

| Network | Requirements |
|---------|-------------|
| `local` | Docker running with [midnight-local-network](https://github.com/bricktowers/midnight-local-network) |
| `preview` | Local proof server running (`http://127.0.0.1:6300`) + wallet seed with tNight |
| `preprod` | Local proof server running (`http://127.0.0.1:6300`) + wallet seed with tNight |

### Usage

```bash
# From packages/blockchain/

# Deploy to local network (uses genesis wallet automatically)
npm run deploy-local

# Deploy to preview (seed required)
npm run deploy-preview -- --seed=<hex-seed>

# Deploy to preprod (seed required)
npm run deploy-preprod -- --seed=<hex-seed>
```

### Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--network=<local\|preview\|preprod>` | Target network | `local` |
| `--seed=<hex>` | Wallet seed (required for preview/preprod, defaults to genesis for local) | — |
| `--dry-run` | Print deployed address but skip writing to `shared/config/contracts.ts` | off |

### Post-Deploy Flow

1. Script deploys VaultRegistry and prints the contract address
2. Address is written to `shared/config/contracts.ts` → `CONTRACTS.VaultRegistry.address`
3. Browser extension and mobile app import from `shared/config/contracts.ts` (ADR-004)
4. Rebuild apps to pick up the new address

## Next Steps (AliasVault)

Future contracts to implement:
1. **`GuardianRecovery.compact`** — Guardian-based password recovery with time-lock
