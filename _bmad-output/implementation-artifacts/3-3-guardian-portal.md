# Story 3.3: Guardian Portal

Status: review

## Story

As a guardian,
I want a web interface to connect my wallet, view pending recovery requests, and approve them,
so that I can help my friend regain access to their vault.

## Acceptance Criteria

1. Standalone Vite + React 18+ app scaffolded at `services/guardian-portal/`
2. `services/*` added to `pnpm-workspace.yaml` so the portal is part of the monorepo
3. Connect Wallet button detects and connects Lace wallet via `window.midnight.mnLace` DApp connector
4. Guardian key management: generate guardian key (32 bytes) + RSA key pair on first visit; store in localStorage keyed by contract address
5. Guardian setup page: display guardian commitment (hex) and RSA public key (JWK) for sharing with vault owner
6. Approval page at route `/approve/:cid` — fetches `RecoveryMetadata` from IPFS via CID in URL
7. Display recovery request details: vault owner commitment, time initiated, approval count, 72h countdown timer
8. "Approve" action: joins GuardianRecovery contract instance, calls `approveRecovery()` circuit with guardian key witness
9. Error states: wallet not detected, not a registered guardian, no active recovery, already approved, recovery cancelled/completed
10. Unit tests for services (wallet, key management, contract interaction, IPFS fetch) and component rendering

## Tasks / Subtasks

- [x] Task 1: Scaffold Vite + React + TypeScript project (AC: #1)
  - [x] 1.1 Create `services/guardian-portal/` with `npm create vite@latest` — React + TypeScript template
  - [x] 1.2 Configure `vite.config.ts` with base path, build output to `dist/`
  - [x] 1.3 Configure `tsconfig.json` with `strict: true`, target ES2020+ (Web Crypto support)
  - [x] 1.4 Add `react-router-dom` for client-side routing (`/approve/:cid`, `/setup`, `/`)
  - [x] 1.5 Add Vitest for unit testing

- [x] Task 2: Monorepo integration (AC: #2)
  - [x] 2.1 Add `"services/*"` to `pnpm-workspace.yaml` packages array
  - [x] 2.2 Add workspace dependencies to `services/guardian-portal/package.json`:
    - `@aliasvault/vault-sync: "workspace:*"` (recovery crypto, key generation)
    - `@aliasvault/contract: "workspace:*"` (assertCIDv1, contract types)
  - [x] 2.3 Add external dependencies:
    - `@midnight-ntwrk/midnight-js-contracts@3.0.0`
    - `@midnight-ntwrk/midnight-js-http-client-proof-provider@3.0.0`
    - `@midnight-ntwrk/midnight-js-indexer-public-data-provider@3.0.0`
    - `@midnight-ntwrk/compact-runtime@0.14.0`
  - [x] 2.4 Run `pnpm install` from project root — verify workspace resolution
  - [x] 2.5 Add `build` and `test` scripts to `turbo.json` pipeline if not auto-detected

- [x] Task 3: Shared types and network configuration (AC: #6, #7)
  - [x] 3.1 Create `services/guardian-portal/src/types/recovery.ts`:
    ```typescript
    interface RecoveryMetadata {
      version: 1;
      contractAddress: string;         // GuardianRecovery contract address
      networkId: string;               // 'mainnet' | 'preprod' | 'undeployed'
      vaultOwnerCommitment: string;    // hex (for display/verification)
    }
    ```
  - [x] 3.2 Create `services/guardian-portal/src/config/networkConfig.ts`:
    - Map networkId → proof server URL, indexer URL, node URL
    - Default to `'undeployed'` for local dev (matches browser extension)
    - Import pattern from `apps/browser-extension/src/entrypoints/popup/config/networkConfig.ts`
  - [x] 3.3 Export `RecoveryMetadata` type from `@aliasvault/vault-sync` as well (shared type for extension + portal)

- [x] Task 4: Wallet connection service (AC: #3)
  - [x] 4.1 Create `services/guardian-portal/src/services/walletService.ts`
  - [x] 4.2 Implement `detectLaceWallet(): boolean` — check `window.midnight?.mnLace` exists (direct access, NOT Chrome scripting API — this is a regular web page, not an extension)
  - [x] 4.3 Implement `connectWallet(networkId: string): Promise<WalletConnection>` — call `lace.connect(networkId)`, get shielded address via `getShieldedAddresses()`
  - [x] 4.4 Implement `disconnectWallet(): void`
  - [x] 4.5 Define `WalletConnection` type: `{ address: string, isConnected: boolean }`
  - [x] 4.6 Create `services/guardian-portal/src/context/WalletContext.tsx` — React context wrapping wallet state (connected, address, connecting)

- [x] Task 5: Guardian key management service (AC: #4, #5)
  - [x] 5.1 Create `services/guardian-portal/src/services/guardianKeyService.ts`
  - [x] 5.2 Implement `generateGuardianKeys(contractAddress: string): Promise<GuardianKeys>`:
    - Generate guardian key: `crypto.getRandomValues(new Uint8Array(32))`
    - Generate RSA key pair: `generateGuardianKeyPair()` from `@aliasvault/vault-sync`
    - Store in localStorage: key=`guardian:${contractAddress}`, value=JSON.stringify({guardianKey: hex, rsaPrivateKey: JWK})
    - Return `{ guardianKey, commitment, rsaPublicKey, rsaPrivateKey }`
  - [x] 5.3 Implement `loadGuardianKeys(contractAddress: string): GuardianKeys | null` — load from localStorage
  - [x] 5.4 Implement `getGuardianCommitment(guardianKey: Uint8Array): Uint8Array` — call `pureCircuits.guardianCommitment(guardianKey)` from compiled contract
  - [x] 5.5 Implement `hasStoredKeys(contractAddress: string): boolean` — check if keys exist in localStorage
  - [x] 5.6 **CRITICAL:** Guardian commitment MUST use `pureCircuits.guardianCommitment()` from the compiled GuardianRecovery contract, NOT a manual `persistentCommit`. The pure circuit uses domain separator `pad(32, "recovery:guardian:")`.

- [x] Task 6: Midnight contract service (AC: #7, #8)
  - [x] 6.1 Create `services/guardian-portal/src/services/midnightService.ts`
  - [x] 6.2 Implement `joinContract(contractAddress: string, guardianKey: Uint8Array, networkConfig): Promise<ContractHandle>`:
    - Use `findDeployedContract()` from `@midnight-ntwrk/midnight-js-contracts`
    - Pass compiled GuardianRecovery contract
    - Set private state with `guardianKey` via `createGuardianRecoveryPrivateState(undefined, guardianKey)` — undefined for secretKey (guardians don't have owner key), guardianKey for witness
    - Use `httpClientProofProvider` and `indexerPublicDataProvider` from network config
  - [x] 6.3 Implement `getContractState(handle): Promise<GuardianRecoveryState>`:
    - Read ledger: `owner`, `guardians`, `guardianCount`, `recoveryInitiatedAt`, `approvedGuardians`, `sharesCidHash`, `recoveryComplete`
    - Return typed state object
  - [x] 6.4 Implement `isGuardian(handle, guardianCommitment): boolean` — check `guardians.member(commitment)` from ledger state
  - [x] 6.5 Implement `approveRecovery(handle): Promise<void>` — call `impureCircuits.approveRecovery()` on contract handle
  - [x] 6.6 Handle errors: "Not a guardian", "Recovery not active", "Already approved", proof generation failures
  - [x] 6.7 **CRITICAL:** The guardian joins with `privateStateId: 'guardianRecoveryPrivateState'` — different from the owner's private state ID. Check `guardian-recovery-api.ts` for the exact pattern used in `joinGuardianRecovery()`.

- [x] Task 7: IPFS service (AC: #6)
  - [x] 7.1 Create `services/guardian-portal/src/services/ipfsService.ts`
  - [x] 7.2 Implement `fetchRecoveryMetadata(cid: string): Promise<RecoveryMetadata>`:
    - Fetch from public IPFS gateway: `https://gateway.pinata.cloud/ipfs/${cid}` (or configurable gateway)
    - Parse JSON, validate structure
    - Validate CID format with `assertCIDv1()` from `@aliasvault/contract`
  - [x] 7.3 Handle errors: invalid CID, fetch failure, malformed metadata
  - [x] 7.4 Note: Guardian portal only READS from IPFS (fetches metadata). It does NOT write to IPFS.

- [x] Task 8: React pages and components (AC: #3, #5, #6, #7, #8, #9)
  - [x] 8.1 Create `services/guardian-portal/src/App.tsx` with React Router:
    - `/` → HomePage (info + setup flow)
    - `/setup/:contractAddress` → SetupPage (generate keys, display commitment)
    - `/approve/:cid` → ApprovalPage (main approval flow)
    - `*` → NotFoundPage
  - [x] 8.2 Create `services/guardian-portal/src/components/WalletConnect.tsx`:
    - "Connect Lace Wallet" button
    - Shows connected address when connected
    - "Disconnect" option
    - Error state: "Lace wallet not detected — please install the Lace browser extension"
  - [x] 8.3 Create `services/guardian-portal/src/pages/SetupPage.tsx`:
    - Guardian connects wallet
    - Generates guardian key + RSA key pair (stored in localStorage)
    - Displays guardian commitment (hex) — copyable
    - Displays RSA public key (JWK JSON) — copyable
    - Instructions: "Share these with the vault owner"
    - If keys already exist for this contract address, show existing commitment + option to regenerate
  - [x] 8.4 Create `services/guardian-portal/src/pages/ApprovalPage.tsx`:
    - Fetches RecoveryMetadata from IPFS via `:cid` URL param
    - Shows loading state while fetching
    - After metadata loaded: prompts wallet connection
    - After wallet connected: loads guardian keys from localStorage, joins contract
    - Verifies guardian is registered in contract (commitment membership check)
    - If not registered → error message with link to setup page
    - If registered → shows RecoveryDetails + ApprovalButton
  - [x] 8.5 Create `services/guardian-portal/src/components/RecoveryDetails.tsx`:
    - Vault owner commitment (truncated hex with copy)
    - Recovery initiated timestamp (human-readable)
    - Approvals: X of 2 required (show which guardians have approved)
    - 72h countdown timer: live countdown showing hours:minutes:seconds remaining
    - Status badge: "Pending", "Approved (waiting for time-lock)", "Claimable", "Completed", "Cancelled"
  - [x] 8.6 Create `services/guardian-portal/src/components/ApprovalButton.tsx`:
    - Disabled if: already approved, no active recovery, recovery completed/cancelled
    - Click → calls `approveRecovery()` via midnight service
    - Loading state during transaction submission
    - Success: "Your approval has been recorded on-chain"
    - Error: display contract error message
  - [x] 8.7 Create `services/guardian-portal/src/pages/HomePage.tsx`:
    - Brief explanation of AliasVault guardian recovery
    - Two paths: "I was invited as a guardian" (→ setup) and "I need to approve a recovery" (→ explains they need a link from vault owner)
  - [x] 8.8 Create `services/guardian-portal/src/pages/NotFoundPage.tsx`

- [x] Task 9: Unit tests (AC: #10)
  - [x] 9.1 Create `services/guardian-portal/src/services/__tests__/walletService.test.ts`:
    - Test `detectLaceWallet()` with/without `window.midnight`
    - Test `connectWallet()` success and failure paths
  - [x] 9.2 Create `services/guardian-portal/src/services/__tests__/guardianKeyService.test.ts`:
    - Test `generateGuardianKeys()` returns valid keys
    - Test localStorage persistence: generate → load → keys match
    - Test `hasStoredKeys()` before/after generation
  - [x] 9.3 Create `services/guardian-portal/src/services/__tests__/ipfsService.test.ts`:
    - Test `fetchRecoveryMetadata()` with valid CID → returns metadata
    - Test invalid CID rejection
    - Test malformed metadata rejection
  - [x] 9.4 Create component tests with `@testing-library/react`:
    - WalletConnect: renders connect button, shows address after connect
    - ApprovalButton: disabled states, click handler
    - RecoveryDetails: renders countdown, approval count
  - [x] 9.5 Create `services/guardian-portal/src/pages/__tests__/ApprovalPage.test.ts`:
    - Test full flow with mocked services: fetch metadata → connect wallet → load keys → show details → approve

- [x] Task 10: Build and verify (AC: all)
  - [x] 10.1 Build: `cd services/guardian-portal && pnpm build` — zero TypeScript errors
  - [x] 10.2 Test: `cd services/guardian-portal && npx vitest run` — all tests pass
  - [x] 10.3 Regression: `cd shared/vault-sync && npx vitest run` — no regressions
  - [x] 10.4 Regression: `cd packages/blockchain/contract && npx vitest run` — no regressions
  - [x] 10.5 Regression: `cd packages/blockchain/cli && npx vitest run` — no regressions
  - [ ] 10.6 Dev server: `cd services/guardian-portal && pnpm dev` — Vite dev server starts, pages render

## Dev Notes

### Architecture Compliance (CRITICAL)

**ADR-003: Shared Business Logic.** All recovery crypto functions are in `shared/vault-sync/`. The portal imports `generateGuardianKeyPair()`, `bytesToHex()`, `hexToUint8Array()`, and other utilities from `@aliasvault/vault-sync`. Do NOT duplicate crypto logic in the portal.

**ADR-007: Pattern 6 v2 (Inverted Shamir).** The portal does NOT need to know about the Shamir secret, encryption key, or master password. Guardians only interact with the **approval circuit** on-chain. The actual share decryption happens in Story 3.4 (Recovery Claim Flow) from the vault owner's side.

**The Guardian Portal has TWO distinct flows:**

1. **Setup Flow** (`/setup/:contractAddress`): Guardian generates keys, shares commitment + public key with vault owner. This happens BEFORE recovery is needed.
2. **Approval Flow** (`/approve/:cid`): Guardian approves an active recovery request. This happens DURING recovery.

### Wallet Connection: Web Page vs Extension (CRITICAL)

The browser extension (Story 1.2) accesses Lace via Chrome scripting API with `world: "MAIN"` injection because extensions can't directly access page `window` objects. The guardian portal is a **regular web page** — it accesses `window.midnight.mnLace` DIRECTLY.

```typescript
// ❌ WRONG: Extension pattern (Chrome scripting injection)
const results = await browser.scripting.executeScript({
  target: { tabId }, world: 'MAIN',
  func: () => (window as any).midnight?.mnLace
});

// ✅ CORRECT: Web page pattern (direct access)
const lace = (window as any).midnight?.mnLace;
if (!lace) throw new Error('Lace wallet not detected');
const wallet = await lace.connect(networkId);
const addresses = await wallet.getShieldedAddresses();
```

Lace v4+ API:
- `lace.connect(networkId)` — returns connected wallet instance
- `wallet.getShieldedAddresses()` — returns shielded address array
- No `.enable()` or `.state()` — those are older API versions
- `networkId` string from network config (e.g., `'undeployed'` for local dev)

### Guardian Key Architecture (CRITICAL)

Each guardian needs TWO types of keys:

| Key | Purpose | Generated | Stored | Used By |
|-----|---------|-----------|--------|---------|
| Guardian Key (32 bytes) | Contract auth via `approveRecovery()` witness | Portal setup page | localStorage | Portal (approval) |
| RSA Key Pair (2048-bit) | Encrypt/decrypt Shamir shares | Portal setup page | localStorage (private), shared (public) | Vault owner (encrypt share), Guardian (decrypt during recovery in Story 3.4) |

**Guardian Key → Commitment flow:**
```typescript
import { guardianRecoveryContract } from '@aliasvault/contract';

// Generate key
const guardianKey = crypto.getRandomValues(new Uint8Array(32));

// Compute commitment using compiled contract's pure circuit
const commitment = guardianRecoveryContract.pureCircuits.guardianCommitment(guardianKey);
// This uses persistentCommit<Bytes<32>>(pad(32, "recovery:guardian:"), gk) internally

// The COMMITMENT (public) is shared with vault owner
// The KEY (secret) stays in localStorage
```

**DO NOT** compute the commitment manually — ALWAYS use `pureCircuits.guardianCommitment()` from the compiled contract. This ensures the domain separator (`"recovery:guardian:"`) is correct.

### Contract Interaction Pattern

The guardian portal connects to an EXISTING GuardianRecovery contract deployed by the vault owner. Pattern from `guardian-recovery-api.ts`:

```typescript
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import {
  guardianRecoveryContract,
  createGuardianRecoveryPrivateState,
  guardianRecoveryWitnesses,
} from '@aliasvault/contract';

async function joinAsGuardian(contractAddress: string, guardianKey: Uint8Array, config: NetworkConfig) {
  const providers = {
    proofProvider: httpClientProofProvider(config.proofServerUrl),
    publicDataProvider: indexerPublicDataProvider(config.indexerUrl, config.wsIndexerUrl),
  };

  const contract = await findDeployedContract(providers, {
    contractAddress,
    compiledContract: guardianRecoveryContract,
    privateStateId: 'guardianRecoveryPrivateState',
    initialPrivateState: createGuardianRecoveryPrivateState(undefined, guardianKey),
    // undefined for secretKey (guardian doesn't have owner's key)
    // guardianKey for local_guardian_key() witness
  });

  return contract;
}

// Then approve:
await contract.callTx.approveRecovery();
```

**CRITICAL:** The `createGuardianRecoveryPrivateState(secretKey, guardianKey)` signature — pass `undefined` for `secretKey` (guardians don't have the owner's secret key), and the guardian's key as `guardianKey`.

### Reading Contract Ledger State

The ledger state can be read from the contract handle without a transaction:

```typescript
const ledger = contract.deployTxData.public;
// Available fields:
// ledger.owner: Bytes<32>               — vault owner's commitment
// ledger.guardians: Set<Bytes<32>>      — registered guardian commitments
// ledger.guardianCount: Counter         — number of guardians
// ledger.recoveryInitiatedAt: Uint<64>  — 0 if no recovery, unix timestamp otherwise
// ledger.approvedGuardians: Set<Bytes<32>> — commitments of guardians who approved
// ledger.sharesCidHash: Bytes<32>       — hash of IPFS CID with shares
// ledger.recoveryComplete: Boolean      — true after successful claim
```

To check if current guardian has approved: check if their commitment is in `approvedGuardians` set.

To compute 72h unlock time: `recoveryInitiatedAt + 259200` (seconds). Display countdown: `unlockTime - currentTime`.

### RecoveryMetadata (IPFS)

When the vault owner initiates recovery (from the browser extension), they upload a small JSON blob to IPFS:

```typescript
interface RecoveryMetadata {
  version: 1;
  contractAddress: string;           // GuardianRecovery contract address
  networkId: string;                 // Target Midnight network
  vaultOwnerCommitment: string;      // hex (for display/verification)
}
```

The CID of this metadata is embedded in the portal URL: `https://guardians.aliasvault.id/approve/{cid}`

The portal fetches this metadata to know which contract to connect to. All other state (approvals, timer, etc.) is read from the contract directly — this avoids stale data.

**Note:** The creation of this metadata and the portal URL is NOT part of this story. It will be handled by the browser extension when `initiateRecovery()` is called. This story defines the metadata structure and consumes it.

### 72-Hour Countdown Timer

Recovery initiated at `recoveryInitiatedAt` (unix seconds on-chain). Unlock time = `recoveryInitiatedAt + 259200` seconds (72 hours).

```typescript
function getCountdown(recoveryInitiatedAt: bigint): { hours: number; minutes: number; seconds: number; expired: boolean } {
  const unlockTime = Number(recoveryInitiatedAt) + 259200;
  const now = Math.floor(Date.now() / 1000);
  const remaining = unlockTime - now;
  if (remaining <= 0) return { hours: 0, minutes: 0, seconds: 0, expired: true };
  return {
    hours: Math.floor(remaining / 3600),
    minutes: Math.floor((remaining % 3600) / 60),
    seconds: remaining % 60,
    expired: false,
  };
}
// Update every second via setInterval
```

### localStorage Key Schema

```
guardian:{contractAddress}:keys → JSON.stringify({
  guardianKeyHex: string,     // 64-char hex of 32-byte key
  rsaPrivateKey: JsonWebKey,  // Guardian's RSA private key
  rsaPublicKey: JsonWebKey,   // Guardian's RSA public key (for sharing)
  commitment: string,         // hex of guardianCommitment — pre-computed for quick lookup
})
```

**Security note:** localStorage is device-local and cleared on browser data wipe. If a guardian loses their keys, the vault owner must `removeGuardian()` and re-add with new commitment. This is acceptable for MVP — guardians rarely change devices.

### What EXISTS — Reuse These

| Component | Location | Usage |
|-----------|----------|-------|
| `generateGuardianKeyPair()` | `@aliasvault/vault-sync` | RSA-OAEP 2048-bit key pair for share encryption |
| `bytesToHex()` / `hexToUint8Array()` | `@aliasvault/vault-sync` | Hex encoding guardian key and commitment |
| `assertCIDv1()` | `@aliasvault/contract` | Validate CID format when fetching metadata |
| `guardianRecoveryContract` | `@aliasvault/contract` | Compiled contract (circuits + pure circuits) |
| `createGuardianRecoveryPrivateState()` | `@aliasvault/contract` | Private state factory for witness setup |
| `guardianRecoveryWitnesses` | `@aliasvault/contract` | Witness definitions for contract interaction |
| `findDeployedContract()` | `@midnight-ntwrk/midnight-js-contracts` | Join existing contract instance |
| `httpClientProofProvider` | `@midnight-ntwrk/midnight-js-http-client-proof-provider` | Proof server connection |
| `indexerPublicDataProvider` | `@midnight-ntwrk/midnight-js-indexer-public-data-provider` | Indexer connection |
| Network config pattern | `apps/browser-extension/.../networkConfig.ts` | Reference for network URL mapping |
| Wallet connection pattern | `apps/browser-extension/.../WalletMessageHandler.ts` | Reference (adapt for direct web page access) |

### What NOT to Do (Anti-Patterns)

- **DO NOT** use Chrome scripting API for wallet connection — this is a web page, access `window.midnight.mnLace` directly
- **DO NOT** duplicate crypto logic from `@aliasvault/vault-sync` — import shared functions
- **DO NOT** compute guardian commitment manually with `persistentCommit` — use `pureCircuits.guardianCommitment()` from compiled contract
- **DO NOT** store guardian keys in Midnight private state — private state is for contract witnesses during transactions, not persistent storage. Use localStorage.
- **DO NOT** hardcode contract addresses — read from RecoveryMetadata (IPFS) or URL params
- **DO NOT** create a backend server — the guardian portal is a fully static client-side app. All contract interaction happens directly from the browser via Midnight SDK.
- **DO NOT** use `Buffer` — use `Uint8Array` everywhere for browser compatibility
- **DO NOT** import from `apps/browser-extension/` — violates ADR-003 dependency direction
- **DO NOT** use Node.js `crypto` module — use Web Crypto API (`crypto.subtle`) exclusively
- **DO NOT** store any sensitive data in the URL — only the IPFS CID of non-sensitive metadata

### Midnight SDK in Browser

The `@midnight-ntwrk/*` packages work in browser environments. However:
- Proof generation can be CPU-intensive (several seconds). Show a loading indicator during `approveRecovery()`.
- The proof provider URL must be accessible from the browser (CORS headers required on the proof server).
- WebSocket connection to indexer is needed for real-time state updates.
- If SDK packages have Node.js-specific imports, Vite's `resolve.alias` or `define` config may be needed. Check `apps/browser-extension/wxt.config.ts` for any polyfill patterns.

### Project Structure

```
services/guardian-portal/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
├── vitest.config.ts
├── src/
│   ├── main.tsx                          # React entry point
│   ├── App.tsx                           # Router + layout
│   │
│   ├── config/
│   │   └── networkConfig.ts              # Network → URLs mapping
│   │
│   ├── types/
│   │   └── recovery.ts                   # RecoveryMetadata, GuardianKeys types
│   │
│   ├── context/
│   │   └── WalletContext.tsx              # React context for wallet state
│   │
│   ├── services/
│   │   ├── walletService.ts              # Lace wallet connection (direct)
│   │   ├── guardianKeyService.ts         # Key gen, storage, commitment
│   │   ├── midnightService.ts            # Contract join, read state, approve
│   │   ├── ipfsService.ts               # Fetch RecoveryMetadata from IPFS
│   │   └── __tests__/
│   │       ├── walletService.test.ts
│   │       ├── guardianKeyService.test.ts
│   │       └── ipfsService.test.ts
│   │
│   ├── pages/
│   │   ├── HomePage.tsx                  # Landing page
│   │   ├── SetupPage.tsx                 # Key generation + display
│   │   ├── ApprovalPage.tsx              # Main approval flow
│   │   ├── NotFoundPage.tsx              # 404
│   │   └── __tests__/
│   │       └── ApprovalPage.test.tsx
│   │
│   └── components/
│       ├── WalletConnect.tsx             # Connect/disconnect wallet
│       ├── RecoveryDetails.tsx           # Recovery state + 72h timer
│       ├── ApprovalButton.tsx            # Approve action button
│       └── __tests__/
│           ├── WalletConnect.test.tsx
│           ├── RecoveryDetails.test.tsx
│           └── ApprovalButton.test.tsx
│
└── dist/                                 # Build output (future: pin to IPFS)
```

### SDK Versions (VERIFIED WORKING — from Stories 2.1-3.2v2)

| Component | Version |
|-----------|---------|
| Compact CLI | 0.4.0 (language >= 0.20) |
| compact-runtime | 0.14.0 |
| midnight-js-contracts | 3.0.0 |
| midnight-js-http-client-proof-provider | 3.0.0 |
| midnight-js-indexer-public-data-provider | 3.0.0 |
| wallet-sdk | 1.0.0 |
| React | 18+ |
| Vite | 6+ |
| TypeScript | 5+ |
| react-router-dom | 6+ |

### Build Commands

```bash
# Install workspace dependencies (from project root)
pnpm install

# Build portal
cd services/guardian-portal && pnpm build

# Run tests
cd services/guardian-portal && npx vitest run

# Dev server
cd services/guardian-portal && pnpm dev

# Regression checks (from project root)
cd shared/vault-sync && npx vitest run
cd packages/blockchain/contract && npx vitest run
cd packages/blockchain/cli && npx vitest run
```

### Testing Strategy

- **Service unit tests:** Mock `window.midnight`, localStorage, fetch API. Test wallet detection, key generation/persistence, IPFS fetch, contract state reading.
- **Component tests:** `@testing-library/react` for rendering, user interaction, state display. Mock service layer.
- **Integration test:** Full approval flow with all services mocked — fetch metadata → connect wallet → load keys → verify guardian → display details → approve → success.
- **No E2E in this story:** Live contract/IPFS/wallet integration requires a running Midnight network + Lace extension. Covered in future E2E story.

### Previous Story Learnings (Stories 3.1, 3.2, 3.2v2)

**From Story 3.1 (Guardian Contract):**
- `createGuardianRecoveryPrivateState(secretKey, guardianKey?)` — pass `undefined` for secretKey when joining as guardian
- `approveRecovery()` requires `local_guardian_key()` witness — the guardian key must be in private state
- Guardian commitment domain separator is `"recovery:guardian:"` — different from owner's `"recovery:owner:"`
- `removeGuardian()` blocked during active recovery (state mutation guard)
- Post-recovery terminal state: `recoveryComplete = true` is permanent. New contract needed for next recovery.
- Cross-instance test pattern: inject attacker's private state into another simulator's `circuitContext` — useful for testing "not a guardian" rejection

**From Story 3.2v2 (Inverted Shamir):**
- RSA-OAEP handles odd-length hex with 1-byte flag prefix — `encryptShareForGuardian()` already handles this
- `generateGuardianKeyPair()` is ready to use — generates RSA-OAEP 2048-bit pair as JWK
- `sha256()` from utils is async (Web Crypto), works in browser
- All crypto uses Web Crypto API exclusively — no Node.js `crypto` module
- `BufferSource` cast needed for `crypto.subtle` calls in TS5+ strict mode

**From Story 1.2 (Wallet Connection):**
- Lace v4+ API: `lace.connect(networkId)` + `getShieldedAddresses()` — NOT older `.enable()` or `.state()`
- Network ID from centralized config — `'undeployed'` for local dev
- Extension uses `WalletResult<T>` pattern for error handling (webext-bridge limitation) — portal doesn't need this, can throw errors directly
- `WalletContext` wraps state: isConnected, address, isConnecting — same pattern applies to portal

### Cross-Story Context

| Story | Relationship |
|-------|-------------|
| 3.1 (Guardian Contract) | **Done.** Contract deployed per-vault. Portal joins existing instance. All circuits available. |
| 3.2v2 (Inverted Shamir) | **Done.** `generateGuardianKeyPair()` used for RSA key generation. Share encryption/decryption functions ready. |
| 3.4 (Recovery Claim) | **Next.** Owner claims shares after 2+ guardians approve + 72h timer. Portal's approval enables this. |
| 1.2 (Wallet Connection) | **Done.** Reference for Lace API patterns. Portal uses simpler direct access (not extension injection). |

### Deployment (Future — Not This Story)

Architecture specifies IPFS hosting with Pinata pinning and DNS TXT records. This story builds the app. Deployment scripts (`deploy/pin-to-ipfs.sh`, `verify-pin.sh`, `update-dns.sh`) are a follow-up task, not blocking the portal functionality.

### References

- [Source: _bmad-output/architecture.md#Guardian-Portal-Directory-Structure] — Full directory structure, component layout
- [Source: _bmad-output/architecture.md#Guardian-Notification-Protocol] — IPFS portal notification flow, RecoveryMetadata
- [Source: _bmad-output/architecture.md#Guardian-Approval-Flow] — Contract interaction for approval
- [Source: _bmad-output/project-context.md#Rule-3] — Shared Business Logic Enforcement (ADR-003)
- [Source: _bmad-output/project-context.md#Rule-9] — Compact Contract Ownership Pattern (persistentCommit)
- [Source: _bmad-output/project-context.md#Rule-15] — GuardianRecovery Contract Patterns
- [Source: _bmad-output/project-context.md#Rule-16] — Shamir & RSA-OAEP Implementation Patterns
- [Source: packages/blockchain/cli/src/guardian-recovery-api.ts] — Contract API wrappers (joinGuardianRecovery, approveRecovery)
- [Source: packages/blockchain/contract/src/guardian-recovery.compact] — Contract source (circuits, ledger, witnesses)
- [Source: packages/blockchain/contract/src/guardian-recovery-witnesses.ts] — Private state + witness definitions
- [Source: shared/vault-sync/src/recovery-crypto.ts] — RSA key pair generation, crypto utilities
- [Source: apps/browser-extension/src/entrypoints/background/WalletMessageHandler.ts] — Lace wallet API reference
- [Source: apps/browser-extension/src/entrypoints/popup/context/WalletContext.tsx] — React wallet context pattern
- [Source: apps/browser-extension/src/entrypoints/popup/config/networkConfig.ts] — Network configuration pattern
- [Source: apps/browser-extension/src/services/MidnightContractService.ts] — Contract join + interaction pattern
- [Source: _bmad-output/implementation-artifacts/3-1-guardian-smart-contract.md] — Story 3.1 learnings
- [Source: _bmad-output/implementation-artifacts/3-2v2-pattern6-inverted-shamir-refactor.md] — Story 3.2v2 learnings
- [Source: _bmad-output/project-planning-artifacts/epics.md#Story-3.3] — Epic definition

## Known Limitations

- **"Cancelled" status not shown (AC #7 partial):** The on-chain contract resets `recoveryInitiatedAt` to 0 on cancellation, making it indistinguishable from "never started." A dedicated `recoveryCancelled` ledger field would be needed. Deferred to a future story. See `guardian-recovery.compact cancelRecovery()` circuit.
- **React Router v6 deprecation warnings:** v7 future flag warnings (`v7_startTransition`, `v7_relativeSplatPath`) appear in test output. Non-functional; deferred.

## Change Log

- 2026-02-24: Story 3.3 implemented — guardian portal scaffolded, all services/components/tests created, regressions clean
- 2026-02-24: Code review round 3 fixes — removed `as` cast in ApprovalPage (M3), documented Cancelled limitation (M4), updated file list +4 files (H2), corrected test counts 42→68 across 9 files (M1)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- `createGuardianRecoveryPrivateState()` signature: pass `new Uint8Array(32)` placeholder for secretKey (guardian doesn't have owner key), guardianKey for witness — matches `guardian-recovery-api.ts:joinGuardianRecovery()` pattern
- `midnightService.ts` uses `findDeployedContract` directly with GuardianRecovery.Contract, guardianRecoveryWitnesses, and privateStateId `'guardianRecoveryPrivateState'` — adapted from CLI pattern which uses `CompiledContract.make()` wrapper (browser doesn't need zkConfigPath for file assets)
- Used `hexToUint8Array` from vault-sync instead of Node `Buffer.from` — browser compatibility per story anti-patterns
- turbo.json `build` and `test` tasks already use glob-based auto-detection; no explicit guardian-portal entry needed

### Completion Notes List

- Task 1: Scaffolded Vite 6 + React 18 + TypeScript 5 app at `services/guardian-portal/` with strict TS config, Vitest, react-router-dom
- Task 2: Added `"services/*"` to pnpm-workspace.yaml, workspace deps (@aliasvault/vault-sync, @aliasvault/contract), Midnight SDK deps. pnpm install clean.
- Task 3: Created RecoveryMetadata type in vault-sync (shared), re-exported from portal types. Created networkConfig.ts with all Midnight networks.
- Task 4: walletService.ts with detect/connect/disconnect using direct `window.midnight.mnLace` access. WalletContext.tsx wraps state.
- Task 5: guardianKeyService.ts generates 32-byte key + RSA pair via vault-sync, computes commitment via `pureCircuits.guardianCommitment()`, persists to localStorage keyed by contract address.
- Task 6: midnightService.ts with joinContract, getContractState, isGuardian, hasApproved, approveRecovery. Uses findDeployedContract + guardianRecoveryWitnesses.
- Task 7: ipfsService.ts fetches RecoveryMetadata from IPFS gateway, validates CIDv1, validates metadata structure.
- Task 8: All pages (Home, Setup, Approval, NotFound) and components (WalletConnect, RecoveryDetails with 72h countdown, ApprovalButton with loading/success/error states). Full approval flow with state machine in ApprovalPage.
- Task 9: 68 tests across 9 test files — walletService (8), guardianKeyService (12), ipfsService (6), WalletConnect (7), RecoveryDetails (10), ApprovalButton (5), ApprovalPage integration (9), networkConfig (4), midnightService (7). All pass.
- Task 10: All portal tests pass (68/68). Regression: vault-sync 63/63, contract 69/69 +3 skipped, cli 42/42.

### File List

New files:
- services/guardian-portal/package.json
- services/guardian-portal/tsconfig.json
- services/guardian-portal/vite.config.ts
- services/guardian-portal/vitest.config.ts
- services/guardian-portal/index.html
- services/guardian-portal/src/main.tsx
- services/guardian-portal/src/App.tsx
- services/guardian-portal/src/vite-env.d.ts
- services/guardian-portal/src/test-setup.ts
- services/guardian-portal/src/config/networkConfig.ts
- services/guardian-portal/src/types/recovery.ts
- services/guardian-portal/src/context/WalletContext.tsx
- services/guardian-portal/src/services/walletService.ts
- services/guardian-portal/src/services/guardianKeyService.ts
- services/guardian-portal/src/services/midnightService.ts
- services/guardian-portal/src/services/ipfsService.ts
- services/guardian-portal/src/pages/HomePage.tsx
- services/guardian-portal/src/pages/SetupPage.tsx
- services/guardian-portal/src/pages/ApprovalPage.tsx
- services/guardian-portal/src/pages/NotFoundPage.tsx
- services/guardian-portal/src/components/WalletConnect.tsx
- services/guardian-portal/src/components/RecoveryDetails.tsx
- services/guardian-portal/src/components/ApprovalButton.tsx
- services/guardian-portal/src/services/__tests__/walletService.test.ts
- services/guardian-portal/src/services/__tests__/guardianKeyService.test.ts
- services/guardian-portal/src/services/__tests__/ipfsService.test.ts
- services/guardian-portal/src/services/__tests__/midnightService.test.ts
- services/guardian-portal/src/config/__tests__/networkConfig.test.ts
- services/guardian-portal/src/__mocks__/compact-js-stub.ts
- services/guardian-portal/src/components/ErrorBoundary.tsx
- services/guardian-portal/src/components/__tests__/WalletConnect.test.tsx
- services/guardian-portal/src/components/__tests__/RecoveryDetails.test.tsx
- services/guardian-portal/src/components/__tests__/ApprovalButton.test.tsx
- services/guardian-portal/src/pages/__tests__/ApprovalPage.test.tsx

Modified files:
- pnpm-workspace.yaml (added "services/*")
- shared/vault-sync/src/recovery-setup.ts (added RecoveryMetadata interface)
- shared/vault-sync/src/index.ts (added RecoveryMetadata export)
- _bmad-output/implementation-artifacts/sprint-status.yaml (3-3 status updated)
- _bmad-output/implementation-artifacts/3-3-guardian-portal.md (tasks, status, dev record)
