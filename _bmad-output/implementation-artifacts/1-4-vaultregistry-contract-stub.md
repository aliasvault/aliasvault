# Story 1.4: VaultRegistry Contract Stub

Status: done

---

## Story

**As a** developer  
**I want** to deploy a basic VaultRegistry contract  
**So that** I can start registering vault owners on-chain

---

## Acceptance Criteria

1. VaultRegistry.compact contract scaffolded → **DONE**
2. `registerVault(walletAddress)` function implemented → **DONE**: Takes `Bytes<32>` hash, asserts uniqueness via Set membership
3. Contract deploys to Midnight testnet → **DONE**: Deployed to local Midnight network via TUI
4. Registration transaction succeeds → **DONE**: Tested via TUI — register, ledger check, duplicate rejection

---

## Tasks / Subtasks

- [x] **Task 1: Contract Implementation** (AC: #1, #2)
  - [x] 1.1: Create `contract/src/vault-registry.compact` with `pragma language_version >= 0.20`
  - [x] 1.2: Define ledger state: `registrations: Set<Bytes<32>>`, `totalVaults: Counter`
  - [x] 1.3: Implement `registerVault(walletAddressHash: Bytes<32>)` circuit with `disclose()` + assert uniqueness
  - [x] 1.4: Implement `isRegistered(walletAddressHash: Bytes<32>): Boolean` query circuit
  - [x] 1.5: Compile contract: `compact compile src/vault-registry.compact src/managed/vault-registry`

- [x] **Task 2: TypeScript Integration** (AC: #3)
  - [x] 2.1: Update `contract/src/index.ts` to export VaultRegistry alongside Counter
  - [x] 2.2: Create `counter-cli/src/vault-registry-types.ts` — TS type definitions
  - [x] 2.3: Create `counter-cli/src/vault-registry-api.ts` — deploy, join, registerVault, isRegistered, getLedgerState
  - [x] 2.4: Update `contract/package.json` with compile scripts for vault-registry

- [x] **Task 3: Test TUI** (AC: #3, #4)
  - [x] 3.1: Create `counter-cli/src/tui_vault_registry.ts` — interactive test entry point
  - [x] 3.2: Test flow: build wallet → configure providers → deploy → check initial state → register → check updated state → duplicate rejection
  - [x] 3.3: Add `npm run vault-registry` script to `packages/blockchain/package.json`

---

## Dev Notes

### Contract Design

- Both `registrations` and `totalVaults` are public ledger state (exported)
- `disclose()` is called on circuit params before ledger operations (required by Compact for circuit inputs used in ledger ops)
- Duplicate registration fails with assert: "Vault already registered"
- Both circuits compiled: k=9, ~305-308 rows each

### Privacy Note

- `disclose(walletAddressHash)` puts the hash on the public ledger. This is intentional for a registration stub. The full VaultRegistry (Epic 2) will use private state for CID storage.

---

## Dev Agent Record

### Agent Model Used

Multiple sessions (Cascade / Claude) — implemented outside BMAD flow, retroactively documented.

### Completion Notes List

- Contract deployed and tested on local Midnight network
- Contract address from test: `ac7cf01759cf510fa5b5592b3ae34cbfda1ed084623c66836a5f96ef82df376b`
- All TUI tests passed: deploy, register, ledger state check, duplicate rejection

### Change Log

| Date | Author | Description |
|------|--------|-------------|
| 2026-01-13 | Ozi3o | Initial implementation (commit 135a8c51) |
| 2026-02-07 | Amelia (CR) | Code review: fixed checkIsRegistered return value, removed blanket eslint-disable |

### File List

**Created:**
- `packages/blockchain/contract/src/vault-registry.compact` — Contract source (24 lines)
- `packages/blockchain/contract/src/managed/vault-registry/` — Compiled artifacts (keys, zkir, TS bindings)
- `packages/blockchain/counter-cli/src/vault-registry-api.ts` — Contract interaction API
- `packages/blockchain/counter-cli/src/vault-registry-types.ts` — TypeScript type definitions
- `packages/blockchain/counter-cli/src/tui_vault_registry.ts` — Test TUI

**Modified:**
- `packages/blockchain/contract/src/index.ts` — Added VaultRegistry export
- `packages/blockchain/contract/package.json` — Added compile scripts
- `packages/blockchain/counter-cli/package.json` — Added vault-registry dependency
- `packages/blockchain/package.json` — Added `vault-registry` npm script
- `packages/blockchain/README.md` — Documented VaultRegistry contract

### Senior Developer Review (AI)

**Reviewed:** 2026-02-07 by Amelia (Dev Agent)

**Issues Found:** 0 High, 4 Medium, 3 Low
**Issues Fixed:** 2 Medium (checkIsRegistered hardcoded true, blanket eslint-disable)

**Remaining Action Items:**
- [x] [AI-Review][MEDIUM] Unit tests added: vault-registry-simulator.ts + vault-registry.test.ts (5/5 pass)
- [x] [AI-Review][MEDIUM] `witnesses.ts` now exports `VaultRegistryPrivateState` alongside Counter types
- [ ] [AI-Review][LOW] TUI test uses TextEncoder truncation for hash instead of proper hashing
- [ ] [AI-Review][LOW] `disclose()` exposes wallet hash publicly — acceptable for stub, revisit for full VaultRegistry (Epic 2)
