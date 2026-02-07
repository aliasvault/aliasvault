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
wsl bash -lc "cd counter-cli && rm -rf dist && npx tsc --project tsconfig.build.json"

# 4. Start local Midnight network (in another terminal)
# cd ~/projects/midnight-local-network && docker compose up

# 5. Run the Counter TUI (connects to already-running local network)
cd counter-cli
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
├── counter-cli/               # CLI tools for contract deployment & interaction
│   ├── src/
│   │   ├── api.ts                    # Counter contract interaction API
│   │   ├── vault-registry-api.ts     # VaultRegistry contract interaction API
│   │   ├── vault-registry-types.ts   # VaultRegistry TypeScript types
│   │   ├── cli.ts                    # Interactive TUI menus (counter)
│   │   ├── config.ts                 # Network configurations
│   │   ├── tui_local.ts             # Counter TUI (direct-connect, no Docker)
│   │   ├── tui_vault_registry.ts    # VaultRegistry test TUI
│   │   └── standalone.ts            # Entry point that starts its own Docker containers
│   └── package.json
└── package.json               # Workspace root
```

## Contracts

### Counter (starter example)
Simple counter contract from the Midnight example-counter template. Used for SDK integration testing.

### VaultRegistry (Story 1.4)
Vault registration contract — tracks which wallet addresses have registered vaults.

- **Ledger state**: `registrations: Set<Bytes<32>>` + `totalVaults: Counter`
- **Circuits**: `registerVault(walletAddressHash)` + `isRegistered(walletAddressHash)`
- Duplicate registration fails with assert: "Vault already registered"
- Deployed & tested on local network

**Run test TUI:** `npm run vault-registry` (from `packages/blockchain/`)

## Next Steps (AliasVault)

Future contracts to implement:
1. **`VaultRegistry.compact` (full)** — Add vault CID storage, access control, ownership transfer
2. **`GuardianRecovery.compact`** — Guardian-based password recovery with time-lock
