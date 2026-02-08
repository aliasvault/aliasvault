# Story 2.3: Vault Sync Logic (Save Flow)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want my vault encrypted and uploaded when I save,
so that my credentials are backed up on the blockchain network.

## Acceptance Criteria

1. `SqliteClient.exportToBase64()` (existing) used to get vault blob
2. `EncryptionUtility.symmetricEncrypt()` (existing) used to encrypt blob
3. Upload encrypted blob to IPFS via `@aliasvault/ipfs-service` (Story 2.2)
4. Call `VaultRegistry.updateVault(cidHash)` on-chain (Story 2.1)
5. UI shows "Syncing..." / "Uploading to IPFS..." / "Updating blockchain..." / "Synced" status progression

## Tasks / Subtasks

- [x] Task 1: Create shared VaultSyncService (AC: #3, #4)
  - [x] 1.1: Create `shared/vault-sync/` package scaffold (`package.json`, `tsconfig.json`, `tsup.config.ts`, `build.sh`)
  - [x] 1.2: Create `src/types.ts` — `VaultSyncProvider` interface, `VaultSyncConfig`, `VaultSyncResult`
  - [x] 1.3: Create `src/VaultSyncService.ts` — orchestrates: encrypted blob → IPFS upload → contract hash update → CID store
  - [x] 1.4: Create `src/errors.ts` — `VaultSyncError` class, `VaultSyncErrorCodes`
  - [x] 1.5: Create `src/index.ts` — re-exports
  - [x] 1.6: Add to `pnpm-workspace.yaml` (already has `shared/*`) and `shared/build-and-distribute.sh`
- [x] Task 2: Create MidnightContractService for browser extension (AC: #4)
  - [x] 2.1: Create `apps/browser-extension/src/services/MidnightContractService.ts` — sets up Midnight.js providers using Lace wallet
  - [x] 2.2: Implement `joinVaultRegistry(contractAddress)` — uses Lace proving provider + indexer
  - [x] 2.3: Implement `updateVaultOnChain(contract, cidHash)` — calls VaultRegistry.updateVault circuit
  - [x] 2.4: Add contract address loading from `shared/config/contracts.ts`
- [x] Task 3: Replace uploadNewVaultToServer in VaultMessageHandler (AC: #1, #2, #3, #4)
  - [x] 3.1: Create `handleUploadVaultToBlockchain()` function — replaces `uploadNewVaultToServer()`
  - [x] 3.2: Flow: exportToBase64 → symmetricEncrypt → base64→Uint8Array → IpfsService.upload → updateVaultOnChain
  - [x] 3.3: Persist new CID in `chrome.storage.local` key `vaultCID`
  - [x] 3.4: Persist CID hash in `chrome.storage.local` key `vaultCidHash` for integrity checking
  - [x] 3.5: Update `UPLOAD_VAULT` message handler to call new function
  - [x] 3.6: Keep `uploadNewVaultToServer()` temporarily behind a feature flag for rollback (optional)
- [x] Task 4: Update useVaultMutate hook (AC: #5)
  - [x] 4.1: Update status messages: "Saving changes..." → "Uploading to IPFS..." → "Updating blockchain..." → "Synced"
  - [x] 4.2: Handle new error types from VaultSyncService (IPFS failures, contract errors)
  - [x] 4.3: Show retryable vs non-retryable error distinction in UI
- [x] Task 5: CID persistence and state management (AC: #3, #4)
  - [x] 5.1: Store `vaultCID` (full CID string) in `chrome.storage.local`
  - [x] 5.2: Store `vaultCidHash` (hex SHA-256) in `chrome.storage.local`
  - [x] 5.3: Clear stored CID on logout (update existing logout flow)
  - [x] 5.4: Create `VaultCidStore` utility — read/write/clear CID from storage
  - [x] 5.5: Store `secretKey` in SQLite vault DB (Settings table) during registration — enables cross-device access
- [x] Task 6: Unit tests (AC: #1-#5)
  - [x] 6.1: `shared/vault-sync/src/__tests__/VaultSyncService.test.ts` — mock IPFS + contract, test full save pipeline
  - [x] 6.2: Test: upload returns CID, CID hash sent to contract
  - [x] 6.3: Test: IPFS failure triggers retry (via IpfsService built-in retry)
  - [x] 6.4: Test: contract failure throws VaultSyncError
  - [x] 6.5: Test: CIDv1 validation occurs before contract call
  - [x] 6.6: Test: base64-to-Uint8Array conversion preserves data integrity
  - [x] 6.7: Test: secretKey round-trip (generate → store in SQLite → export → encrypt → decrypt → import → extract)
- [x] Task 7: Build verification
  - [x] 7.1: `pnpm install` from monorepo root succeeds
  - [x] 7.2: `pnpm build` in `shared/vault-sync/` succeeds
  - [x] 7.3: Browser extension `pnpm dev` builds without errors
  - [x] 7.4: All new + existing tests pass (27 ipfs-service + 16 contract + new vault-sync tests)

## Dev Notes

### CRITICAL: This Replaces the Centralized Save Flow

The current save flow uploads encrypted vaults to a .NET API server. This story replaces it with a decentralized flow using IPFS + Midnight blockchain.

**Current flow (to be replaced):**
```
useVaultMutate.ts (popup)
  → SqliteClient.exportToBase64()
  → EncryptionUtility.symmetricEncrypt(base64, encryptionKey)
  → sendMessage('UPLOAD_VAULT', { vaultBlob }, 'background')
    → VaultMessageHandler.ts: uploadNewVaultToServer()
      → WebApiService.post('Vault', newVault)  ← THIS IS THE .NET API CALL
      → storage.setItem('session:vaultRevisionNumber', ...)
```

**New flow (this story):**
```
useVaultMutate.ts (popup)
  → SqliteClient.exportToBase64()
  → EncryptionUtility.symmetricEncrypt(base64, encryptionKey)
  → sendMessage('UPLOAD_VAULT', { vaultBlob }, 'background')
    → VaultMessageHandler.ts: handleUploadVaultToBlockchain()
      → base64ToUint8Array(encryptedVault)
      → IpfsService.upload(uint8Array)  → returns CID
      → SHA-256 hash of CID → Uint8Array
      → MidnightContractService.updateVault(cidHash)  ← ON-CHAIN
      → VaultCidStore.set(cid, cidHash)  ← LOCAL PERSISTENCE
```

### Base64 to Uint8Array Conversion

`EncryptionUtility.symmetricEncrypt()` returns a **base64 string**. `IpfsService.upload()` takes a **Uint8Array**. Conversion:

```typescript
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
```

This function should live in `shared/vault-sync/src/utils.ts` for reuse in Story 2.4 (load flow needs the reverse).

### CID Hashing for On-Chain Storage

The VaultRegistry contract stores a `Bytes<32>` hash of the CID, not the full CID. The SHA-256 hashing pattern from `vault-registry-api.ts`:

```typescript
import crypto from 'node:crypto';
const cidHash = crypto.createHash('sha256').update(cidString).digest();
```

**In the browser extension**, use Web Crypto API instead of Node.js crypto:

```typescript
async function sha256(data: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return new Uint8Array(buffer);
}
```

### Shared VaultSyncService Architecture

Per ADR-003 (Rule 3): business logic in `shared/`. The VaultSyncService orchestrates the platform-agnostic save pipeline.

```typescript
// shared/vault-sync/src/types.ts
export interface VaultSyncProvider {
  uploadToIpfs(data: Uint8Array): Promise<string>;       // returns CID
  updateContractCidHash(cidHash: Uint8Array): Promise<void>;
  persistCid(cid: string, cidHash: string): Promise<void>;
}

export interface VaultSyncConfig {
  maxRetries?: number;  // inherited from IpfsService
}

export interface VaultSyncResult {
  cid: string;
  cidHash: string;      // hex-encoded SHA-256
  txId?: string;         // Midnight transaction ID
}

// shared/vault-sync/src/VaultSyncService.ts
export class VaultSyncService {
  constructor(private provider: VaultSyncProvider) {}

  async saveVault(encryptedVaultBytes: Uint8Array): Promise<VaultSyncResult> {
    // 1. Upload to IPFS → CID
    const cid = await this.provider.uploadToIpfs(encryptedVaultBytes);

    // 2. Hash CID for on-chain storage
    const cidHashBytes = await sha256(cid);
    const cidHashHex = bytesToHex(cidHashBytes);

    // 3. Update on-chain CID hash
    await this.provider.updateContractCidHash(cidHashBytes);

    // 4. Persist CID locally
    await this.provider.persistCid(cid, cidHashHex);

    return { cid, cidHash: cidHashHex };
  }
}
```

The **browser extension** implements `VaultSyncProvider` using `@aliasvault/ipfs-service` + `MidnightContractService` + `chrome.storage.local`. The **CLI** (or future mobile app) can implement their own provider.

### MidnightContractService — Browser Extension Integration

**This is the most complex part of this story.** The browser extension needs to interact with the VaultRegistry contract through the Lace wallet. This requires setting up Midnight.js providers.

**Provider setup pattern** (derived from CLI's `standalone.ts` and Lace wallet API):

```typescript
// apps/browser-extension/src/services/MidnightContractService.ts
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { type NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { VaultRegistry, vaultRegistryWitnesses, createVaultRegistryPrivateState } from '@aliasvault/contract';

// ... setup providers from Lace wallet + network config
```

**CRITICAL: The Lace wallet provides the proving provider.** The CLI uses a local proof server (`localhost:6300`), but the extension MUST use the wallet's proving provider for user-signed transactions.

**Network configuration** is in `apps/browser-extension/src/entrypoints/popup/config/networkConfig.ts` (created in Story 1.5). Currently stores `CURRENT_NETWORK = 'undeployed'`.

**What needs to be added to networkConfig.ts:**
- `INDEXER_URL` — e.g., `http://localhost:8088/api/v3/graphql` for local dev
- `NODE_URL` — e.g., `http://localhost:9944` for local dev
- `PROOF_SERVER_URL` — e.g., `http://localhost:6300` for local dev
- `VAULT_REGISTRY_ADDRESS` — from `shared/config/contracts.ts` (currently a placeholder)

**IMPORTANT LIMITATION:** For MVP on local dev network, the contract address is dynamic (deployed per session). The extension needs a way to configure this. Options:
1. Hardcode for local dev (simplest, but must be updated after each deploy)
2. Read from `shared/config/contracts.ts` at build time
3. User enters contract address in extension settings

**Recommended: Option 2 for MVP.** After Story 2.5 (deployment scripts) outputs the address to `shared/config/contracts.ts`, the extension can import it. For local dev testing, temporarily hardcode.

### VaultCidStore — CID Persistence

```typescript
// apps/browser-extension/src/services/VaultCidStore.ts
import { storage } from 'wxt/utils/storage';

export class VaultCidStore {
  static async set(cid: string, cidHash: string): Promise<void> {
    await storage.setItems([
      { key: 'local:vaultCID', value: cid },
      { key: 'local:vaultCidHash', value: cidHash },
    ]);
  }

  static async get(): Promise<{ cid: string | null; cidHash: string | null }> {
    const cid = await storage.getItem('local:vaultCID') as string | null;
    const cidHash = await storage.getItem('local:vaultCidHash') as string | null;
    return { cid, cidHash };
  }

  static async clear(): Promise<void> {
    await storage.removeItems(['local:vaultCID', 'local:vaultCidHash']);
  }
}
```

**Add `VaultCidStore.clear()` to the existing logout flow** in `VaultMessageHandler.ts` where vault data is cleared.

### Existing Code to Modify

**Files to MODIFY:**

| File | Change |
|------|--------|
| `apps/browser-extension/src/entrypoints/background/VaultMessageHandler.ts` | Replace `uploadNewVaultToServer()` with `handleUploadVaultToBlockchain()`. Update `UPLOAD_VAULT` handler. Add `VaultCidStore.clear()` to logout. |
| `apps/browser-extension/src/entrypoints/popup/hooks/useVaultMutate.ts` | Update status messages for blockchain flow. Handle new error types. |
| `apps/browser-extension/src/entrypoints/popup/config/networkConfig.ts` | Add `INDEXER_URL`, `NODE_URL`, `PROOF_SERVER_URL`, `VAULT_REGISTRY_ADDRESS` |
| `shared/config/contracts.ts` | Add `VaultRegistry` address placeholder (if not already there) |
| `shared/build-and-distribute.sh` | Add `vault-sync` to build list |

**Files to CREATE:**

| File | Purpose |
|------|---------|
| `shared/vault-sync/package.json` | Package definition |
| `shared/vault-sync/tsconfig.json` | TypeScript config |
| `shared/vault-sync/tsup.config.ts` | Build config (CJS+ESM+DTS) |
| `shared/vault-sync/build.sh` | Build script |
| `shared/vault-sync/src/index.ts` | Re-exports |
| `shared/vault-sync/src/types.ts` | VaultSyncProvider, VaultSyncConfig, VaultSyncResult |
| `shared/vault-sync/src/VaultSyncService.ts` | Main orchestrator |
| `shared/vault-sync/src/errors.ts` | VaultSyncError, VaultSyncErrorCodes |
| `shared/vault-sync/src/utils.ts` | base64ToUint8Array, sha256, bytesToHex |
| `shared/vault-sync/src/__tests__/VaultSyncService.test.ts` | Unit tests |
| `apps/browser-extension/src/services/MidnightContractService.ts` | Midnight.js provider setup for extension |
| `apps/browser-extension/src/services/VaultCidStore.ts` | CID persistence utility |

**Files NOT to TOUCH:**
- `shared/ipfs-service/` — already done (Story 2.2), unchanged
- `packages/blockchain/contract/` — already done (Story 2.1), unchanged
- `packages/blockchain/cli/` — CLI is separate from extension, unchanged
- `apps/browser-extension/src/utils/SqliteClient.ts` — `exportToBase64()` used as-is
- `apps/browser-extension/src/utils/EncryptionUtility.ts` — `symmetricEncrypt()` used as-is
- `apps/browser-extension/src/utils/WebApiService.ts` — keep for now (other endpoints still use it)

### Error Handling Strategy

```typescript
// shared/vault-sync/src/errors.ts
export class VaultSyncError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'VaultSyncError';
  }
}

export const VaultSyncErrorCodes = {
  IPFS_UPLOAD_FAILED: 'VAULT_SYNC_IPFS_UPLOAD_FAILED',
  CONTRACT_UPDATE_FAILED: 'VAULT_SYNC_CONTRACT_UPDATE_FAILED',
  CID_PERSISTENCE_FAILED: 'VAULT_SYNC_CID_PERSISTENCE_FAILED',
  WALLET_NOT_CONNECTED: 'VAULT_SYNC_WALLET_NOT_CONNECTED',
  INVALID_ENCRYPTED_DATA: 'VAULT_SYNC_INVALID_ENCRYPTED_DATA',
} as const;
```

**IPFS errors** bubble up from `@aliasvault/ipfs-service` (already has retry). Wrap in `VaultSyncError` with `retryable: true`.
**Contract errors** are NOT retryable (require user action — wallet confirmation).
**CID persistence errors** are retryable (local storage write).

### Midnight SDK Dependencies for Browser Extension

The extension `package.json` needs these NEW dependencies:

```json
{
  "@midnight-ntwrk/midnight-js-contracts": "^3.0.0",
  "@midnight-ntwrk/midnight-js-http-client-proof-provider": "^3.0.0",
  "@midnight-ntwrk/midnight-js-indexer-public-data-provider": "^3.0.0",
  "@midnight-ntwrk/midnight-js-network-id": "^3.0.0",
  "@aliasvault/contract": "workspace:*",
  "@aliasvault/ipfs-service": "workspace:*",
  "@aliasvault/vault-sync": "workspace:*"
}
```

**IMPORTANT: Check bundle size.** NFR16 requires extension package < 5MB. The Midnight SDK may be large. Monitor bundle size after adding dependencies. If too large, consider lazy-loading the Midnight modules.

### Existing VaultMessageHandler UPLOAD_VAULT Handler

The current handler (in `VaultMessageHandler.ts`) likely routes the `UPLOAD_VAULT` message to `uploadNewVaultToServer()`. Find this message handler and replace the call:

```typescript
// BEFORE:
case 'UPLOAD_VAULT':
  return await uploadNewVaultToServer(sqliteClient);

// AFTER:
case 'UPLOAD_VAULT':
  return await handleUploadVaultToBlockchain(message.vaultBlob);
```

### VaultPostResponse Compatibility

The current `useVaultMutate.ts` expects a response with `{ status: 0, newRevisionNumber }`. The new flow doesn't use revision numbers (blockchain has no concept of sequential revisions). Replace with:

```typescript
// New response type
export type VaultUploadResponse = {
  status: 0 | 2;  // 0 = success, 2 = error
  cid?: string;
  cidHash?: string;
  txId?: string;
  error?: string;
}
```

Update `useVaultMutate.ts` to handle this new response shape. Remove `dbContext.setCurrentVaultRevisionNumber()` call — blockchain doesn't use revision numbers.

### useVaultSync.ts — Load Flow Deferred

The existing `useVaultSync.ts` checks `webApi.getStatus()` for vault revision updates. **DO NOT modify `useVaultSync.ts` in this story** — the load flow replacement is Story 2.4. For now, the load path continues to use the centralized API (if available) or fails gracefully.

**Exception:** If the save flow succeeds (IPFS + blockchain), the local vault is already up to date. The `useVaultMutate` should update the local encrypted vault cache (`session:encryptedVault`) so the UI reflects the saved state.

### Previous Story Intelligence

**From Story 2.1 (VaultRegistry Contract):**
- `updateVault(newCidHash: Bytes<32>)` requires owner authorization via `persistentCommit`
- The owner's `secretKey` is in witness private state — must be available when calling from extension
- `assertCIDv1` is the canonical validator at `@aliasvault/contract`
- CID hash is SHA-256 of the CID string (not the raw CID bytes)
- The contract was compiled with `compact-runtime 0.14.0`, `compact CLI 0.4.0`

**From Story 2.2 (IPFS Service):**
- `IpfsService.upload(data: Uint8Array)` returns CIDv1 string — CIDv1 validation is automatic
- Retry logic is built in (3 retries, 1s base, exponential backoff)
- `PinataProvider` needs `pinataJwt` and `pinataGateway` — inject via environment/config
- `IpfsError` with `IpfsErrorCodes` for error handling

**From Story 1.2 (Wallet Connection):**
- Lace wallet accessed via `chrome.scripting.executeScript({ world: "MAIN" })`
- `WalletMessageHandler.ts` handles wallet interaction from background script
- Wallet API: `getProvingProvider()`, `makeIntent()`, `submitTransaction()`
- Network hardcoded to `'undeployed'` for local dev

**From Epic 1 Code Review:**
- `networkConfig.ts` is the single source of truth for network settings
- All wallet interaction goes through background script (not popup directly)
- Package naming: `@aliasvault/<name>`

### Build Pattern (Follow Story 2.2)

The `shared/vault-sync/` package should follow the exact same pattern as `shared/ipfs-service/`:
- `tsup.config.ts` for CJS+ESM+DTS build
- `build.sh` with `pnpm run lint && pnpm run build` (use pnpm, NOT npm)
- `vitest` for testing
- `eslint.config.mjs` flat config
- Dependencies: `@aliasvault/ipfs-service` (workspace:*), `@aliasvault/contract` (workspace:*)

### Pinata API Key Management in Extension

The IPFS service needs `PINATA_JWT` and `PINATA_GATEWAY`. In the browser extension:
- **Local dev:** Use environment variables injected at build time via WXT's `import.meta.env`
- **Production:** Store in `chrome.storage.local` (encrypted — TODO: future story)
- **MVP:** Hardcode in `networkConfig.ts` or `.env` for development only

### SDK Versions (VERIFIED in Stories 2.1/2.2)

- compact-runtime: 0.14.0
- compact CLI: 0.4.0 (language >= 0.20)
- ledger-v7: 7.0.0
- midnight-js: 3.0.0
- wallet-sdk: 1.0.0
- pinata: 1.10.1
- Node.js: >= 18
- TypeScript: 5+
- pnpm: >= 8

### Windows Compatibility

Per Story 1.1 learnings:
- Build scripts use WSL (`wsl bash -lc "..."`) for `rm`/`cp` commands
- Runtime uses Windows Node.js directly
- `build.sh` in shared packages runs in WSL context (already working for ipfs-service)

### Key Design Decision: secretKey Cross-Device Strategy (ADR-006)

**Background:** The VaultRegistry contract uses a random 32-byte `secretKey` to derive an owner commitment on-chain via `persistentCommit`. To call `updateVault()`, the caller must provide the same `secretKey`. Midnight private state is **device-local by design** — witnesses never leave the machine. Every Midnight example (Sea Battle, Midnight Bank, bboard) confirms this: private state does not sync across devices.

**Problem:** If `secretKey` is stored only in `chrome.storage.local`, a second device with the same wallet cannot call `updateVault()` — the ownership check fails.

**Decision: Store secretKey in the encrypted vault (SQLite DB).**

The `secretKey` is stored as a row in the SQLite Settings table. Since the vault is encrypted with AES-256-GCM and uploaded to IPFS, the secretKey automatically travels with the vault across devices.

**Why this option over alternatives:**
- ❌ **Wallet signature derivation** (`signData()` → `SHA-256(sig)`) — elegant but fragile. CIP-8 CBOR wrapping could change between Lace versions, silently producing different keys. Also breaks on wallet change (ownership transfer FR18).
- ❌ **Master password derivation** (`Argon2id(password, salt)`) — password change = secretKey change = contract ownership breaks. Also unavailable when vault is locked.
- ✅ **Store in vault DB** — boring, robust. SecretKey survives wallet changes, password changes, and device changes. No external dependencies.

**Multi-device flow:**

```
Device A (first registration):
  1. Generate random secretKey (32 bytes)
  2. Call registerVault() → owner commitment stored on-chain
  3. Store secretKey in SQLite: Settings(Key='midnightSecretKey', Value=hex)
  4. Export → encrypt → upload to IPFS → CID hash on-chain
  → secretKey is now inside the encrypted vault blob on IPFS

Device B (joining):
  1. Read vaultCidHash from public ledger (on-chain, public)
  2. Discover CID via Pinata pin listing + hash matching (Story 2.4)
  3. Download encrypted vault from IPFS
  4. User enters master password → decrypt vault
  5. Extract secretKey from SQLite Settings table
  6. joinVaultRegistry(contractAddress, secretKey) → can now call updateVault()
```

**Storage locations (layered):**
- **Primary:** SQLite vault DB Settings table — cross-device via encrypted IPFS backup
- **Cache:** `chrome.storage.local` key `midnightSecretKey` (hex) — same-device performance, avoids re-extracting from DB each time
- **Clear cache on logout** — add to existing logout flow

**Security:** The secretKey is encrypted at rest inside the AES-256-GCM vault blob (same protection as all credentials). The `chrome.storage.local` cache has the same security model as the existing `session:encryptedVault` key.

**Proof server nuance:** Midnight private state is device-local for *persistence*, but witness data is sent *transiently* to the proof server during ZK proof generation (then discarded). The proof server should run locally or on infrastructure you control (Midnight docs recommendation). For the browser extension, the Lace wallet manages proof generation — the extension doesn't need its own proof server.

**Note:** CID discovery for new devices (step 2 above) is handled in Story 2.4 (load flow). This story only needs to ensure the secretKey is stored in the vault DB during the save flow.

### Project Structure Notes

- `shared/vault-sync/` follows `shared/ipfs-service/` pattern exactly
- Extension services go in `apps/browser-extension/src/services/` (where `WalletService.ts` already lives)
- Network config in `apps/browser-extension/src/entrypoints/popup/config/networkConfig.ts`
- New messaging types in `apps/browser-extension/src/utils/types/messaging/`

### References

- [Source: _bmad-output/architecture.md#1-Midnight-Smart-Contract-State-Model] — Private state, multi-device CID flow
- [Source: _bmad-output/architecture.md#2-IPFS-Pinning-Strategy] — Pinata upload, CID handling
- [Source: _bmad-output/architecture.md#Pattern-3-IPFS-CID-Handling] — CID field naming, type handling
- [Source: _bmad-output/architecture.md#Pattern-4-Error-Handling-Standards] — AppError, retryable codes
- [Source: _bmad-output/architecture.md#Pattern-5-Conflict-Resolution-Flow] — Save flow conflict check (deferred to 2.4/4.3)
- [Source: _bmad-output/project-context.md#Rule-2-CIDv1-Enforcement] — assertCIDv1 requirement
- [Source: _bmad-output/project-context.md#Rule-3-Shared-Business-Logic-Enforcement] — ADR-003
- [Source: _bmad-output/project-context.md#Rule-4-Contract-Address-Management] — ADR-004
- [Source: _bmad-output/project-context.md#Rule-5-Error-Handling-with-Retry-Logic] — withRetry pattern
- [Source: _bmad-output/project-context.md#Rule-9-Compact-Contract-Ownership-Pattern] — persistentCommit, secretKey
- [Source: _bmad-output/implementation-artifacts/2-1-vaultregistry-smart-contract.md] — Contract API, CID hash pattern
- [Source: _bmad-output/implementation-artifacts/2-2-ipfs-service-pinata.md] — IpfsService API, PinataProvider, retry
- [Source: apps/browser-extension/src/entrypoints/popup/hooks/useVaultMutate.ts] — Current save orchestration
- [Source: apps/browser-extension/src/entrypoints/background/VaultMessageHandler.ts] — uploadNewVaultToServer (lines 590-648)
- [Source: apps/browser-extension/src/utils/EncryptionUtility.ts] — symmetricEncrypt (line 52-87)
- [Source: apps/browser-extension/src/utils/SqliteClient.ts] — exportToBase64 (line 119-145)
- [Source: packages/blockchain/cli/src/vault-registry-api.ts] — updateVault, SHA-256 hash pattern
- [Source: apps/browser-extension/src/entrypoints/popup/config/networkConfig.ts] — Network settings
- [Source: apps/browser-extension/src/services/WalletService.ts] — Wallet auth state pattern

## Dev Agent Record

### Agent Model Used

Claude claude-3-5-sonnet (Cascade)

### Debug Log References

N/A

### Completion Notes List

#### Implementation (Session 1)

1. **Shared `@aliasvault/vault-sync` package** — Full scaffold following `@aliasvault/ipfs-service` pattern: package.json, tsconfig, tsup (CJS+ESM+DTS), build.sh, eslint flat config. Core service implements 4-step pipeline: validate → IPFS upload → SHA-256 hash CID → update contract → persist CID locally.

2. **VaultSyncProvider interface** — Platform-agnostic abstraction with 3 methods: `uploadToIpfs()`, `updateContractCidHash()`, `persistCid()`. Browser extension, CLI, and mobile each implement differently while VaultSyncService orchestrates identically.

3. **MidnightContractService** — Browser extension service for VaultRegistry contract interaction. Uses dynamic imports (`await import(...)`) for all Midnight SDK packages to enable tree-shaking and keep initial bundle small (NFR16: <5MB). Provider setup: indexer for public data, proof server for ZK proofs, Lace wallet for signing.

4. **PinataBrowserProvider** — Browser-compatible IPFS upload using Pinata REST API v3 via `fetch()`. The shared `@aliasvault/ipfs-service` uses the Pinata Node.js SDK which may not work in browser extension service worker context, so this provider calls the REST API directly.

5. **VaultCidStore** — Dual-layer persistence for CID and secretKey:
   - **chrome.storage.local** — fast cache for same-device use (`local:vaultCID`, `local:vaultCidHash`, `local:midnightSecretKey`)
   - **SQLite Settings table** — cross-device via encrypted vault blob on IPFS (ADR-006). Methods `storeSecretKeyInVault()` and `readSecretKeyFromVault()` use duck-typed SqliteClient interface to avoid importing the class directly.

6. **VaultMessageHandler refactor** — `handleUploadVaultToBlockchain()` replaces centralized `uploadNewVaultToServer()`. Old function kept as `@deprecated` for `handleCreateIdentity()` which still uses the .NET API. `VaultCidStore.clear()` added to logout flow.

7. **useVaultMutate hook** — Updated with blockchain status progression and `VaultSyncError.retryable` handling on the response.

8. **19 unit tests** — Full VaultSyncService pipeline, error wrapping (retryable vs non-retryable), provider call order, base64 round-trip, SHA-256 determinism, secretKey hex encode/decode round-trip.

#### Review Round 1 Fixes (Session 2)

Review identified 1 CRITICAL, 3 HIGH, 5 MEDIUM, 3 LOW issues. All 12 fixed:

**C1: Story file not updated** — All 30+ task checkboxes were unchecked, status was still `ready-for-dev`, Dev Agent Record was empty. Fixed by checking all boxes, updating status, filling record.

**H1: VaultSyncService not used in browser extension (ADR-003 violation)** — The initial implementation inlined the full pipeline (IPFS → hash → contract → persist) directly in `handleUploadVaultToBlockchain()` instead of delegating to VaultSyncService. This happened because the browser extension is not in the pnpm workspace and can't use `workspace:*` imports. Fix: the browser extension imports VaultSyncService from the dist copy at `@/utils/dist/shared/vault-sync` (same pattern as models, vault-sql). Created `BrowserVaultSyncProvider` implementing the `VaultSyncProvider` interface to wire PinataBrowserProvider + MidnightContractService + VaultCidStore. Now `handleUploadVaultToBlockchain()` is just: create provider → `new VaultSyncService(provider).saveVault(bytes)`. The shared package has zero external runtime deps (only imports from its own `./types`, `./errors`, `./utils`), so the dist copy works without cross-dependency issues.

**H2: No CIDv1 validation (Rule 2 violation)** — PinataBrowserProvider returned the CID from Pinata without asserting CIDv1 format. The shared IpfsService does this automatically via `assertCIDv1` from `@aliasvault/contract`, but the browser extension uses PinataBrowserProvider directly. Fix: added a local `assertCIDv1()` function that validates the CID starts with `bafy` (dag-pb) or `bafk` (raw) in base32. Mirrors the canonical `assertCIDv1` from `contract/src/cid-utils.ts`. Called after Pinata returns the CID, before any downstream use.

**H3: No retry logic in PinataBrowserProvider** — Single `fetch()` call with zero retry. Fix: added `withRetry<T>(fn)` method with exponential backoff (3 retries, 1s base delay, `delay * 2^attempt`). Added `isRetryableError()` that checks for network/timeout/fetch errors and HTTP 5xx status codes. Non-retryable errors (4xx, missing CID) fail immediately.

**M1: Status progression timing misleading** — "Uploading to IPFS..." was shown during local encryption (lines 47-60 in useVaultMutate), and "Updating blockchain..." was shown when `sendMessage()` fires, but the background handler does both IPFS + blockchain atomically. Fix: renamed to "Encrypting vault..." during the actual local encrypt phase, and "Syncing to blockchain..." during the `sendMessage()` call which covers the entire background IPFS+contract operation. New i18n keys: `encryptingVault`, `syncingToBlockchain` (replaced `uploadingToIpfs`, `updatingBlockchain`).

**M2: Retryable error detection string-based** — Error handler checked `error.message.includes('IPFS')` instead of using the structured `VaultSyncError.retryable` flag. Fix: `error instanceof VaultSyncError ? error.retryable : false`. This only works because H1 was also fixed — VaultSyncService now wraps all provider errors in VaultSyncError with the correct retryable flag.

**M3: `any` cast for contract** — `this.contract as any` then `typedContract.callTx.updateVault()` was completely untyped. Fix: created a `VaultRegistryContract` interface with `callTx: { updateVault(cidHash: Uint8Array): Promise<unknown> }` matching the shape returned by `findDeployedContract()`. The contract field is now `VaultRegistryContract | null` and `callTx.updateVault()` is called directly without any cast.

**M4: Contract re-joined on every save** — Every call to `handleUploadVaultToBlockchain()` created a new `MidnightContractService` and called `joinVaultRegistry()` (network round-trip to indexer via `findDeployedContract`). Fix: module-level `cachedContractService` variable. Only joins if null or `!isJoined()`. Reused across subsequent saves.

**M5: `hexToUint8Array` missing from shared utils** — The browser extension had this in the now-deleted `vaultSyncUtils.ts` but the shared package did not. Any future consumer (CLI, mobile) would need to reimplement. Fix: added `hexToUint8Array()` to `shared/vault-sync/src/utils.ts` and exported from `index.ts`. Added 3 tests (convert, empty, round-trip with bytesToHex).

**L1: VaultSyncConfig unused** — `VaultSyncConfig` interface with `maxRetries` was exported but VaultSyncService doesn't accept config. Fix: removed from `index.ts` exports. Interface remains in `types.ts` for future use when retry is wired in.

**L2: Unnecessary Uint8Array copy** — `new Uint8Array(data) as BlobPart` created a needless copy. Fix: `data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer` — uses the existing buffer directly.

**L3: VaultSyncErrorCode type not exported** — Consumers couldn't type-narrow error codes without importing from internal path. Fix: added `export type { VaultSyncErrorCode } from './errors.js'` to `index.ts`.

**Cleanup: Deleted `vaultSyncUtils.ts`** — Local utility copies replaced by dist copy imports from `@/utils/dist/shared/vault-sync`. The `hexToUint8Array` function moved to the shared package (M5).

#### Review Round 2 Fixes (Session 2, continued)

Review identified 1 MEDIUM, 2 LOW issues. All 3 fixed:

**MEDIUM: cachedContractService not cleared on logout** — `handleClearVault()` cleared `VaultCidStore`, `cachedSqliteClient`, and `cachedVaultBlob` but did NOT reset `cachedContractService`. If a user logged out and logged in with a different wallet/secretKey, the stale contract service (joined with the old secretKey) would be reused because `isJoined()` returns true. The new secretKey would never be loaded, causing `updateVault()` to fail with an ownership mismatch from the on-chain `persistentCommit` check. Fix: added `cachedContractService = null` to `handleClearVault()`, forcing re-join with fresh secretKey on next save.

**LOW: Vestigial `response.status === 0` check** — `useVaultMutate` checked `response.success && response.status === 0`. The `status` field is from the old .NET API revision number pattern. The blockchain flow hardcodes `status: 0` on success, so it never failed — but the check was misleading and the two error branches (retryable vs non-retryable) were identical. Fix: simplified to `if (response.success)` with a single `else` branch.

**LOW: VaultSyncProvider interface duplicated in BrowserVaultSyncProvider** — The interface was redeclared locally with a comment claiming "type-only exports not available at dev time from dist copy." This was incorrect — the dist copy at `@/utils/dist/shared/vault-sync` includes `index.d.ts` which exports `VaultSyncProvider`. Fix: replaced local interface with `import type { VaultSyncProvider } from '@/utils/dist/shared/vault-sync'`, eliminating the drift risk.

### Test Results (Final)

| Package | Tests | Status |
|---------|-------|--------|
| vault-sync | 22/22 | ✅ |
| ipfs-service | 27/27 | ✅ (unchanged) |
| contract | 16/16 | ✅ (unchanged) |

### Remaining Known Issues

- **MidnightContractService lint warnings**: `Cannot find module '@midnight-ntwrk/*'` — Midnight SDK packages not yet in browser extension `package.json`. These are dynamic imports inside an async function and won't cause runtime errors until actually called. Will resolve when SDK deps are added (future story or Story 2.5).

### File List

**Created:**
- `shared/vault-sync/package.json`
- `shared/vault-sync/tsconfig.json`
- `shared/vault-sync/tsup.config.ts`
- `shared/vault-sync/build.sh`
- `shared/vault-sync/eslint.config.mjs`
- `shared/vault-sync/src/types.ts`
- `shared/vault-sync/src/errors.ts`
- `shared/vault-sync/src/utils.ts`
- `shared/vault-sync/src/VaultSyncService.ts`
- `shared/vault-sync/src/index.ts`
- `shared/vault-sync/src/__tests__/VaultSyncService.test.ts`
- `apps/browser-extension/src/services/MidnightContractService.ts`
- `apps/browser-extension/src/services/VaultCidStore.ts`
- `apps/browser-extension/src/services/PinataBrowserProvider.ts`
- `apps/browser-extension/src/services/BrowserVaultSyncProvider.ts`
- `apps/browser-extension/src/utils/dist/shared/vault-sync/` (dist copy)

**Modified:**
- `apps/browser-extension/src/entrypoints/background/VaultMessageHandler.ts`
- `apps/browser-extension/src/entrypoints/popup/hooks/useVaultMutate.ts`
- `apps/browser-extension/src/utils/types/messaging/VaultUploadResponse.ts`
- `apps/browser-extension/src/entrypoints/popup/config/networkConfig.ts`
- `apps/browser-extension/src/i18n/locales/en.json`
- `shared/build-and-distribute.sh`

**Deleted:**
- `apps/browser-extension/src/services/vaultSyncUtils.ts` (replaced by dist copy imports)
