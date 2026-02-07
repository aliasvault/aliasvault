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

# 2. Compile the Compact contract (in WSL)
cd contract && compact compile src/counter.compact src/managed/counter && cd ..

# 3. Build TypeScript (in WSL for rm/cp commands)
wsl bash -lc "cd contract && rm -rf dist && npx tsc --project tsconfig.build.json && cp -Rf ./src/managed ./dist/managed && cp ./src/counter.compact ./dist/"
wsl bash -lc "cd counter-cli && rm -rf dist && npx tsc --project tsconfig.build.json"

# 4. Start local Midnight network (in another terminal)
# cd ~/projects/midnight-local-network && docker compose up

# 5. Run the TUI (connects to already-running local network)
cd counter-cli
node --experimental-specifier-resolution=node --loader ts-node/esm src/tui_local.ts
```

## Structure

```
packages/blockchain/
├── contract/                  # Compact smart contracts + TypeScript bindings
│   ├── src/
│   │   ├── counter.compact    # Counter contract (starter, to be extended)
│   │   ├── managed/           # Compiled contract artifacts (auto-generated)
│   │   ├── witnesses.ts       # Witness functions
│   │   └── index.ts           # Contract exports
│   └── package.json
├── counter-cli/               # CLI tools for contract deployment & interaction
│   ├── src/
│   │   ├── api.ts             # Contract interaction API
│   │   ├── cli.ts             # Interactive TUI menus
│   │   ├── config.ts          # Network configurations
│   │   ├── tui_local.ts       # Direct-connect entry point (no Docker spin-up)
│   │   └── standalone.ts      # Entry point that starts its own Docker containers
│   └── package.json
└── package.json               # Workspace root
```

## Next Steps (AliasVault)

The counter contract is a working starting point. Future contracts:
1. **`VaultRegistry.compact`** — Vault CID storage and access control
2. **`GuardianRecovery.compact`** — Guardian-based password recovery
