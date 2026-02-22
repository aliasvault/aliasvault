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
compact compile src/guardian-recovery.compact src/managed/guardian-recovery
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
│   │   ├── counter.compact                # Counter contract (starter example)
│   │   ├── vault-registry.compact         # VaultRegistry contract (vault registration)
│   │   ├── guardian-recovery.compact      # GuardianRecovery contract (guardian recovery)
│   │   ├── managed/                       # Compiled contract artifacts (auto-generated)
│   │   │   ├── counter/                   # Counter compiled output
│   │   │   ├── vault-registry/            # VaultRegistry compiled output
│   │   │   └── guardian-recovery/         # GuardianRecovery compiled output
│   │   ├── witnesses.ts                   # VaultRegistry/Counter witness functions
│   │   ├── guardian-recovery-witnesses.ts # GuardianRecovery witness functions
│   │   └── index.ts                       # Contract exports (Counter + VaultRegistry + GuardianRecovery)
│   └── package.json
├── cli/                       # CLI tools for contract deployment & interaction
│   ├── src/
│   │   ├── api.ts                        # Counter contract interaction API
│   │   ├── vault-registry-api.ts         # VaultRegistry contract interaction API
│   │   ├── vault-registry-types.ts       # VaultRegistry TypeScript types
│   │   ├── guardian-recovery-api.ts      # GuardianRecovery contract interaction API
│   │   ├── guardian-recovery-types.ts    # GuardianRecovery TypeScript types
│   │   ├── deploy-vault-registry.ts  # Headless VaultRegistry deployment script
│   │   ├── deploy-utils.ts           # Deploy utilities (secret key, config update, arg parsing)
│   │   ├── cli.ts                    # Interactive TUI menus (counter)
│   │   ├── config.ts                 # Network configurations
│   │   ├── tui_local.ts             # Counter TUI (direct-connect, no Docker)
│   │   ├── tui_vault_registry.ts    # VaultRegistry test TUI
│   │   ├── standalone.ts            # Entry point that starts its own Docker containers
│   │   └── test/
│   │       ├── deploy-utils.test.ts  # Deploy utility unit tests
│   │       ├── vault-registry-api.test.ts
│   │       └── guardian-recovery-api.test.ts
│   └── package.json
└── package.json               # Workspace root
```

## Contracts

### Counter (starter example)
Simple counter contract from the Midnight example-counter template. Used for SDK integration testing.

### VaultRegistry (Full Specification — Story 2.6)
Vault registration contract with **owner access control**, **backup wallet recovery**, and **on-chain time-locks**.

- **Public ledger** (8 fields):
  - `registrations: Set<Bytes<32>>` — registered wallet address hashes
  - `totalVaults: Counter` — total registered vaults
  - `owner: Bytes<32>` — owner commitment (hiding, via `persistentCommit`)
  - `vaultCidHash: Bytes<32>` — SHA-256 hash of current vault CID
  - `recoveryKeyHash: Bytes<32>` — hash of recovery key (actual key in vault blob per ADR-006)
  - `backupWallets: Set<Bytes<32>>` — authorized backup wallet commitments
  - `transferInitiatedAt: Uint<64>` — Unix epoch seconds when backup transfer initiated
  - `transferInitiator: Bytes<32>` — commitment of backup wallet that initiated transfer
- **Witnesses**: `local_secret_key()`, `local_backup_key()`
- **Circuits** (11 impure + 2 pure):
  - `registerVault(walletAddressHash)` — registers vault, sets owner commitment
  - `updateVault(newCidHash)` — owner-only, updates CID hash on-chain
  - `transferOwnership(newOwnerCommitment)` — owner-only, transfers ownership, resets recovery state
  - `storeRecoveryKeyHash(keyHash)` — owner-only, stores hash of recovery key
  - `addBackupWallet(walletCommitment)` — owner-only, adds backup wallet
  - `removeBackupWallet(walletCommitment)` — owner-only, removes backup wallet
  - `initiateBackupTransfer(currentTime)` — backup-wallet-only, starts 72-hour time-lock
  - `executeBackupTransfer(newOwnerCommitment)` — backup-wallet-only, completes transfer after time-lock
  - `cancelBackupTransfer()` — owner-only, cancels pending transfer
  - `isRegistered(walletAddressHash)` — public, checks registration
  - `ownerCommitment(sk)` — pure, derives owner hiding commitment
  - `backupCommitment(bk)` — pure, derives backup wallet commitment (different domain separator)
- **Canonical spec**: `contract/src/VAULT-REGISTRY-SPEC.md`
- **CIDv1 enforcement**: `assertCIDv1()` in `contract/src/cid-utils.ts` (canonical), re-exported via CLI
- **Tests**: 36 contract unit tests (3 counter + 33 VR, 1 skipped) + 29 CLI tests (13 API + 16 deploy-utils)

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

### GuardianRecovery (Story 3.1)
Per-vault guardian recovery contract with **72-hour time-lock** and **2-of-3 threshold**.

- **Deployment model**: Each vault owner deploys their own instance
- **Public ledger** (7 fields):
  - `owner: Bytes<32>` — owner commitment (hiding, via `persistentCommit`)
  - `guardians: Set<Bytes<32>>` — guardian commitment set (max 3)
  - `guardianCount: Counter` — number of registered guardians
  - `recoveryInitiatedAt: Uint<64>` — Unix epoch seconds when recovery initiated (0 = none)
  - `approvedGuardians: Set<Bytes<32>>` — guardians that approved the current recovery
  - `sharesCidHash: Bytes<32>` — hash of IPFS CID containing encrypted Shamir shares
  - `recoveryComplete: Boolean` — true after successful claimRecovery
- **Witnesses**: `local_secret_key()`, `local_guardian_key()`
- **Circuits** (8 impure + 2 pure):
  - `initialize(ownerCom)` — sets owner commitment on first deploy
  - `addGuardian(guardianCom)` — owner-only, adds guardian (max 3)
  - `removeGuardian(guardianCom)` — owner-only, removes guardian
  - `storeSharesCidHash(cidHash)` — owner-only, stores hash of IPFS CID with encrypted shares
  - `initiateRecovery(currentTime)` — owner-only, starts 72-hour recovery timer
  - `approveRecovery()` — guardian-only, approves active recovery
  - `claimRecovery()` — owner-only, completes recovery after time-lock + threshold
  - `cancelRecovery()` — owner-only, cancels active recovery
  - `ownerCommitment(sk)` — pure, derives owner hiding commitment (`"recovery:owner:"`)
  - `guardianCommitment(gk)` — pure, derives guardian commitment (`"recovery:guardian:"`)
- **Canonical spec**: `contract/src/GUARDIAN-RECOVERY-SPEC.md`

**Build & test:**
```bash
# Compile (from packages/blockchain/contract/)
compact compile src/guardian-recovery.compact src/managed/guardian-recovery

# Run contract tests (from packages/blockchain/contract/)
npx vitest run

# Run CLI tests (from packages/blockchain/cli/)
npx vitest run
```

## Next Steps (AliasVault)

Future stories to implement:
1. **Story 3.2** — Shamir secret splitting (Pattern 6)
