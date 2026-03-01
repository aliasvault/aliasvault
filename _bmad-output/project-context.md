---
project_name: 'aliasvault'
user_name: 'Ozi3o'
date: '2026-01-10'
sections_completed: []
workflow_type: 'generate-project-context'
source_architecture: '_bmad-output/architecture.md'
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code for **AliasVault 2.0**. Focus on unobvious details that agents might otherwise miss._

**⚠️ IMPORTANT: Read the complete [Architecture Document](_bmad-output/architecture.md) before implementing any code. This file supplements the architecture with implementation-specific rules.**

---

## Technology Stack & Versions

### Core Technologies (from Architecture)

**Blockchain & Smart Contracts:**
- Midnight Blockchain SDK (Target: Q4 2025 release)
- Compact (Smart contract language for Midnight)
- MeshJS Midnight Starter Template
- Cardano Wallet Integration (Lace wallet via Mesh SDK)

**Frontend:**
- React 18+
- TypeScript 5+
- WXT (Browser extension framework)
- Vite (for guardian portal)

**Backend Services:**
- Express.js (SMTP bridge microservice)
- Node.js

**Storage:**
- IPFS (via `pinata` SDK v1.10.1 — NOT deprecated `ipfs-http-client` or `@pinata/sdk`)
- Pinata (IPFS pinning service, abstracted via `IpfsProvider` interface in `@aliasvault/ipfs-service`)
- IndexedDB (client-side caching)

**Cryptography:**
- Argon2id (password derivation)
- AES-256-GCM (encryption)
- RSA-OAEP (guardian share encryption)
- secrets.js-34r7h (Shamir Secret Sharing)

**Package Management:**
- pnpm 8+ (monorepo workspace — `packages/*`, `packages/blockchain/*`, `shared/*`, `services/*`)
- TurboRepo (build orchestration with caching)
- Shared packages built with `tsup` (CJS + ESM + DTS), distributed via `build.sh` scripts

**Testing:**
- Jest / Vitest (unit tests)
- Playwright / Cypress (E2E tests for extension)

---

## Critical Implementation Rules

### 1. Inverted Shamir Recovery (CRITICAL - Pattern 6 v2, ADR-007)

**Rule:** The master password is encrypted with an **ephemeral** key derived from a random Shamir secret. The Shamir secret is split into 2-of-3 shares, each encrypted per guardian. The encrypted password is bundled with the shares in a single IPFS package. The recovery key is **never stored** — it is reconstructed from guardian shares during recovery. Only `SHA-256(shamirSecret)` goes on-chain for verification.

> **ADR-007 (2026-02-22):** Replaces original "dual-layer" design which stored recovery key in vault blob (circular dependency — vault blob encrypted with master password the user lost) or Midnight private state (device-local, doesn't sync — ADR-006). See [sources](https://docs.metamask.io/embedded-wallets/infrastructure/sss-architecture/).

**Why this matters:**
- ❌ **WRONG:** Storing recovery key in vault blob → circular dependency (vault encrypted with master password)
- ❌ **WRONG:** Storing recovery key in Midnight private state → device-local, lost on new device (ADR-006)
- ✅ **CORRECT:** Recovery key is ephemeral, derived from Shamir secret → reconstructed from guardian shares during recovery → works cross-device

**Implementation:**
```typescript
// CORRECT: Pattern 6 v2 — Inverted Shamir
const shamirSecret = crypto.getRandomValues(new Uint8Array(32)) // ephemeral
const encryptionKey = await sha256('aliasvault:rk:' + bytesToHex(shamirSecret))
const encryptedPassword = await encryptWithRecoveryKey(masterPassword, encryptionKey)
const shares = shamirSplit(bytesToHex(shamirSecret), 3, 2) // Split the SECRET
const guardianShares = shares.map((share, i) =>
  rsaEncrypt(share, guardians[i].publicKey)
)

// Package: encrypted password + encrypted shares → single IPFS blob
const pkg = { version: 2, encryptedPassword, shares: guardianShares }
await provider.uploadToIpfs(pkg)
await contract.storeRecoveryKeyHash(sha256(bytesToHex(shamirSecret))) // verification hash
// shamirSecret is DISCARDED — never stored anywhere
```

### 2. CIDv1 Enforcement (CRITICAL - Pattern 3)

**Rule:** ALL IPFS CIDs MUST be CIDv1 format, not CIDv0.

**Why this matters:**
- CIDv0 (base58 encoded, starts with "Qm") is deprecated
- CIDv1 (base32 encoded) is case-insensitive and URL-safe
- Midnight contracts store CID **hashes** as `Bytes<32>` → the raw CID never goes on-chain; validated in TypeScript API layer before circuit call

**Canonical implementation** in `packages/blockchain/contract/src/cid-utils.ts`, re-exported via `@aliasvault/contract`:
```typescript
import { assertCIDv1 } from '@aliasvault/contract';

// Usage (MANDATORY before storing)
const cid = await ipfsService.upload(encrypted);
assertCIDv1(cid); // Throws if not CIDv1
await midnightClient.updateVault(cid);
```

**In `@aliasvault/ipfs-service`**, `assertCIDv1` is wrapped in `validateCIDv1()` which throws `IpfsError(IPFS_INVALID_CID)` for consistent error handling. `IpfsService.upload()` and `download()` call this automatically.

### 3. Shared Business Logic Enforcement (ADR-003)

**Rule:** ALL business logic MUST be in `shared/<package>/` as independent packages. Apps only handle UI and platform-specific APIs.

**Why this matters:**
- Prevents platform drift between browser extension and mobile app
- Enables fast unit testing (50ms vs 5min platform tests)
- Ensures single source of truth

**Anti-pattern:**
```typescript
// ❌ WRONG: Business logic in app service
// apps/browser-extension/src/services/vaultService.ts
async function saveVault(vault: Vault) {
  const encrypted = await encrypt(vault, masterPassword) // Business logic!
  // ... more logic
}
```

**Correct pattern:**
```typescript
// ✅ CORRECT: Pure function in shared/logic/
// shared/logic/vaultLogic.ts
export function encryptVault(vault: Vault, masterPassword: string): EncryptedBlob {
  // Pure function - no side effects
  return aesEncrypt(vault, derivedKey)
}

// Apps use thin wrappers
// apps/browser-extension/src/services/vaultService.ts
import { encryptVault } from '@aliasvault/shared/logic'

async function saveVault(vault: Vault) {
  const encrypted = encryptVault(vault, masterPassword) // Call shared logic
  await ipfsClient.upload(encrypted) // Platform-specific I/O
}
```

**Lint rule enforcement:** ESLint must flag business logic in `apps/*/src/services/` (to be added during implementation).

### 4. Contract Address Management (ADR-004)

**Rule:** NEVER hardcode contract addresses. Use `shared/config/contracts.ts` exclusively.

**Why this matters:**
- Prevents version chaos (extension on v2, mobile on v1, portal on v1.5)
- Deployment updates all apps atomically
- Type-safe contract access

**Anti-pattern:**
```typescript
// ❌ WRONG: Hardcoded address
const VAULT_REGISTRY = '0x1234...'
```

**Correct pattern:**
```typescript
// ✅ CORRECT: Import from shared config
import { CONTRACTS } from '@aliasvault/shared/config'

const vaultRegistry = await midnight.loadContract(
  CONTRACTS.VaultRegistry.address,
  CONTRACTS.VaultRegistry.abi
)

// Version check
if (CONTRACTS.VaultRegistry.version !== '2.0.0') {
  throw new Error('Incompatible contract version')
}
```

**Lint rule enforcement:** ESLint must flag any string literal matching contract address regex in app code.

### 5. Error Handling with Retry Logic (Pattern 4)

**Rule:** Network errors MUST be retried using `RETRYABLE_CODES` constant.

**Why this matters:**
- IPFS and Midnight RPC calls can fail transiently
- User experience degrades without retries
- Consistent retry behavior across all network calls

**Implementation:**
**Canonical implementation** in `@aliasvault/ipfs-service`:
```typescript
import { withRetry, IpfsErrorCodes, RETRYABLE_CODES } from '@aliasvault/ipfs-service';

// RETRYABLE (transient): IPFS_UPLOAD_FAILED, IPFS_DOWNLOAD_FAILED, IPFS_PIN_FAILED, IPFS_TIMEOUT
// NOT RETRYABLE (permanent): IPFS_AUTH_FAILED, IPFS_INVALID_CID

// withRetry is built into IpfsService.upload() and download() automatically.
// For other network calls, use withRetry directly:
const result = await withRetry(() => someNetworkCall(), 3, 1000);
// Retries: 1s → 2s → 4s (exponential backoff)
```

### 6. Guardian Recovery Time-Lock (72 hours)

**Rule:** Guardian approvals have a MANDATORY 72-hour time-lock before shares can be claimed.

**Why this matters:**
- Prevents social engineering attacks (attacker tricks guardians)
- Gives legitimate owner time to cancel malicious recovery
- Implemented in `GuardianRecovery.compact` contract

**Implementation note:**
```typescript
// Time-lock starts when THRESHOLD guardians approve (e.g., 2-of-3)
await contract.initiateRecovery(guardians)
// ... guardians approve via portal
// ⏰ WAIT 72 HOURS (enforced by contract)
const shares = await contract.claimShares() // Only after time-lock
```

**Critical:** If backup wallet transfer is also pending, **guardian recovery TAKES PRECEDENCE** and cancels backup transfer (Byzantine failure resolution, documented in architecture).

### 7. Test Organization (Pattern 7)

**Rule:** Follow strict test organization patterns:
- Unit tests: Co-located (e.g., `vaultService.test.ts` next to `vaultService.ts`)
- Integration tests: `__tests__/integration/`
- E2E tests: `__tests__/e2e/`
- Contract tests: Separate `contracts/__tests__/` (needs testnet config isolation)

**Why this matters:**
- Contract tests need different runtime environment (Midnight testnet)
- Co-located unit tests improve discoverability
- Integration tests verify service boundaries

**File naming:**
```
vaultService.ts          # Implementation
vaultService.test.ts     # Unit tests (same directory)
__tests__/integration/vault-sync.integration.test.ts  # Integration
__tests__/e2e/vault-operations.e2e.test.ts           # E2E
```

### 8. Midnight SDK Language Constraint (CRITICAL)

**Rule:** All code that integrates with Midnight blockchain MUST be TypeScript/JavaScript. Do NOT attempt to call Midnight SDK from C#, Go, or other languages.

**Why this matters:**
- Midnight SDK (`@midnight-ntwrk/client-sdk`, `Midnight.js`) is TypeScript-only
- No .NET/C# NuGet package exists
- No Go SDK exists
- Raw HTTP RPC is unsupported and high-risk

**Implications:**
- Browser extension: ✅ TypeScript (can use SDK)
- Express services: ✅ TypeScript (can use SDK)
- Existing .NET services: ❌ Cannot integrate with Midnight directly
- Guardian portal: ✅ React/TypeScript (can use SDK)

**Decision Record:** See [ADR-001: SMTP Infrastructure](file:///docs/architecture/adr-001-smtp-infrastructure.md) for how this constraint affected Epic 5 design.

**Anti-pattern:**
```csharp
// ❌ WRONG: Attempting Midnight calls from C#
var result = await httpClient.PostAsync("https://rpc.midnight.network", ...);
// No type safety, no SDK support, high risk
```

**Correct pattern:**
```typescript
// ✅ CORRECT: Use official SDK from TypeScript
import { MidnightRPC } from '@midnight-ntwrk/client-sdk'

const client = new MidnightRPC(process.env.MIDNIGHT_RPC_URL)
const owner = await client.call({
  contract: 'AliasRegistry',
  method: 'getOwner',
  args: [alias]
})
```

### 9. Compact Contract Ownership Pattern (CRITICAL)

**Rule:** Use `persistentCommit` (hiding commitment) for owner identity in Compact contracts. Never use `persistentHash` for ownership — it leaks the preimage relationship.

**Why this matters:**
- `persistentHash` is deterministic but transparent — an observer can link owner identity across transactions
- `persistentCommit` adds blinding, hiding the secret key relationship (OpenZeppelin ZOwnablePK pattern)
- For non-rotating ownership (e.g., VaultRegistry), use a fixed domain separator as the nonce

**Implementation (Compact):**
```compact
// Derive owner commitment — hiding, non-rotating
export circuit ownerCommitment(sk: Bytes<32>): Bytes<32> {
  return persistentCommit<Bytes<32>>(pad(32, "vault:owner:"), sk);
}

// Verify caller is owner
export circuit updateVault(newCidHash: Bytes<32>): [] {
  const cidHash = disclose(newCidHash);
  const sk = local_secret_key();  // witness
  assert(owner == ownerCommitment(sk), "Not the vault owner");
  vaultCidHash = cidHash;
}
```

**TypeScript witness pattern:**
```typescript
// Private state holds ONLY witness data (secret key for owner auth).
// Application-layer data (e.g., full CID string) is stored separately.
export type VaultRegistryPrivateState = {
  readonly secretKey: Uint8Array;
};

export const vaultRegistryWitnesses = {
  local_secret_key: ({ privateState }: WitnessContext<Ledger, VaultRegistryPrivateState>):
    [VaultRegistryPrivateState, Uint8Array] => [privateState, privateState.secretKey],
};
```

### 10. Compact Language Gotchas (CRITICAL for AI Agents)

**Rule:** These Compact syntax rules are non-obvious and frequently cause compilation failures:

| Gotcha | Wrong | Correct |
|--------|-------|--------|
| `default` is an expression, not a function | `default<Bytes<32>>()` | `default<Bytes<32>>` |
| `disclose()` required before conditional/ledger use | `assert(x == y)` | `assert(disclose(x) == y)` |
| `persistentCommit` signature | `persistentCommit(nonce, [nonce, value])` | `persistentCommit<NonceType>(nonce, value)` |
| Circuit params need `disclose()` | `registrations.member(param)` | `registrations.member(disclose(param))` |
| `pad()` for string-to-Bytes | `"vault:owner:"` (bare string) | `pad(32, "vault:owner:")` |
| Pragma required | (missing) | `pragma language_version >= 0.20;` |
| Return empty tuple, not Void | `): Void {` | `): [] {` |
| No `currentTimestamp()` | `currentTimestamp()` or `block.timestamp` | `blockTimeGte(time)` where `time: Uint<64>` (Unix epoch seconds). Also: `blockTimeGt`, `blockTimeLt`, `blockTimeLte`. Available since Compact 0.17. |
| `Uint<64>` arithmetic needs cast through Field | `registeredAt + 259200` | `(((registeredAt as Field) + (259200 as Field)) as Uint<64>)` |

**Reference:** Always call `midnight-get-latest-syntax` MCP tool before writing Compact code.

### 11. Contract Unit Testing Pattern

**Rule:** Use the simulator pattern for contract unit tests. Each contract gets a `*-simulator.ts` that wraps the compiled contract with typed methods.

**Why this matters:**
- Tests run in <2s without a live network
- Simulator provides typed access to ledger state and circuit calls
- Pure circuits (`pureCircuits.*`) can be called for off-circuit verification

**Pattern:**
```typescript
// vault-registry-simulator.ts
export class VaultRegistrySimulator {
  constructor(secretKey: Uint8Array, backupKey?: Uint8Array) {
    this.contract = new Contract<VaultRegistryPrivateState>(vaultRegistryWitnesses);
    const initialPrivateState = createVaultRegistryPrivateState(secretKey, backupKey);
    // ... createConstructorContext, createCircuitContext
  }
  // circuitContext is public so tests can inject cross-instance state for access control testing
  public registerVault(hash: Uint8Array): Ledger { /* impureCircuits.registerVault */ }
  public static ownerCommitment(sk: Uint8Array): Uint8Array {
    return pureCircuits.ownerCommitment(sk);  // Off-circuit verification
  }
  public static backupCommitment(bk: Uint8Array): Uint8Array {
    return pureCircuits.backupCommitment(bk);  // Different domain separator
  }
}
```

**Limitation:** Simulator `blockTimeGte()` always returns `true` regardless of argument (confirmed in Story 3.6 — `blockTimeGte(259201)` passes when block time is 0). This means time-lock tests cannot be validated in the simulator. Use E2E on local Midnight network for time-lock testing. Tests that depend on `blockTimeGte` returning `false` must be `.skip`ped with E2E justification.

### 12. Midnight Private State is Device-Local (ADR-006)


**Rule:** Midnight private state (witnesses) NEVER syncs across devices. Any secret that must be available on multiple devices MUST be stored inside the encrypted vault blob (SQLite DB), not solely in `chrome.storage.local` or Midnight private state.

**Why this matters:**
- Midnight's ZK architecture keeps witnesses local — this is a privacy feature, not a bug
- Every Midnight example (Sea Battle, Midnight Bank, bboard) confirms: private state is lost on device change/reload
- The `secretKey` used for VaultRegistry owner proof must be recoverable on new devices

**Correct pattern:**
```typescript
// ✅ CORRECT: Store secretKey in SQLite vault DB (travels with encrypted vault)
sqliteClient.execute(
  "INSERT OR REPLACE INTO Settings (Key, Value) VALUES ('midnightSecretKey', ?)",
  [hexEncode(secretKey)]
);
// Vault export → encrypt → IPFS upload → secretKey is now in the backup

// On new device: download vault → decrypt → extract secretKey
const row = sqliteClient.execute("SELECT Value FROM Settings WHERE Key = 'midnightSecretKey'");
const secretKey = hexDecode(row.Value);
```

**Anti-pattern:**
```typescript
// ❌ WRONG: secretKey only in chrome.storage.local — lost on new device
await chrome.storage.local.set({ midnightSecretKey: hexEncode(secretKey) });
// Second device with same wallet cannot call updateVault()
```

**Alternatives evaluated and rejected:**
- ❌ Wallet signature derivation (`signData()` → SHA-256) — fragile, breaks on wallet change
- ❌ Master password derivation — breaks on password change, unavailable when locked
- See Story 2.3 for full analysis

---

### 13. pnpm Strict Hoisting & Transitive Dependencies (Story 2.5)


**Rule:** When a package imports a module that is only a transitive dependency (not explicitly listed in its `package.json`), pnpm's strict hoisting may not make it available at runtime. Always add explicit dependencies for packages imported directly.

**Why this matters:**
- pnpm uses strict hoisting — transitive deps are stored in `.pnpm/` but not hoisted to `node_modules/`
- If package A imports `rxjs` but only has it as a transitive dep via package B, the import fails at runtime
- ESM module resolution is stricter than CommonJS and will NOT resolve transitive-only packages
- This affects all packages using `npm` (not pnpm) within a pnpm monorepo workspace

**Error pattern:**
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'rxjs' imported from ...
```

**Fix:**
```json
// packages/blockchain/package.json
{
  "dependencies": {
    "rxjs": "^7.8.2"  // Explicitly add even though it's already a transitive dep
  }
}
```

**Discovery:** Story 2.5 — `api.ts` imports `rxjs`, but `rxjs` was only listed as a transitive dependency of `@midnight-ntwrk/wallet-sdk-*` packages. Added `rxjs: ^7.8.2` to fix runtime resolution.

### 14. Compact ADT Operations, Sentinel Values & Domain Separators (updated 2026-02-20)

**Rule:** Compact `Set`, `Map`, and `Counter` all have a `resetToDefault()` method that bulk-clears the structure in-circuit. Circuits cannot iterate over members, but bulk-clearing is fully supported. Compact also supports `Map<K,V>` ledger state and `struct` user-defined types.

**ADT operations available IN circuits:**
- `Set<T>`: `.insert()`, `.remove()`, `.member()`, `.isEmpty()`, `.size()`, `.resetToDefault()`
- `Map<K,V>`: `.insert(k,v)`, `.lookup(k)`, `.member(k)`, `.remove(k)`, `.isEmpty()`, `.size()`, `.resetToDefault()`
- `Counter`: `.increment(n)`, `.decrement(n)`, `.read()`, `.lessThan(n)`, `.resetToDefault()`
- Iteration (`[Symbol.iterator]`) is TypeScript-only — not available in circuits

**`struct` syntax:**
```compact
export struct RecoveryState {
  initiatedAt: Uint<64>,
  complete: Boolean,
}
```

**Sentinel values:** Use `0` as sentinel for "no value" on optional `Uint<64>` fields. Guard against sentinel collision:
```compact
// Reject zero timestamp — 0 is the sentinel for "no transfer initiated"
assert(time != (0 as Uint<64>), "Invalid timestamp");
```

**Multi-role commitment pattern (prevent cross-role collisions):**
```compact
pure circuit ownerCommitment(sk: Bytes<32>): Bytes<32> {
  persistentCommit<Bytes<32>>(pad(32, "vault:owner:"), sk)
}
pure circuit backupCommitment(bk: Bytes<32>): Bytes<32> {
  persistentCommit<Bytes<32>>(pad(32, "vault:backup:"), bk)
}
```

Multi-role commitments MUST use different domain separators (`"vault:owner:"` vs `"vault:backup:"`) to prevent cross-role commitment collisions even when using the same underlying key.

### 15. GuardianRecovery Contract Patterns (Story 3.1)

**Rule:** GuardianRecovery is a separate per-vault contract. Each vault owner deploys their own instance. The application layer coordinates between GuardianRecovery and VaultRegistry — there are no cross-contract calls.

**Domain separators (MUST differ from VaultRegistry):**
```compact
// GuardianRecovery — unique domain separators
ownerCommitment(sk):    persistentCommit<Bytes<32>>(pad(32, "recovery:owner:"), sk)
guardianCommitment(gk): persistentCommit<Bytes<32>>(pad(32, "recovery:guardian:"), gk)

// VaultRegistry — different domain (DO NOT mix)
ownerCommitment(sk):    persistentCommit<Bytes<32>>(pad(32, "vault:owner:"), sk)
backupCommitment(bk):   persistentCommit<Bytes<32>>(pad(32, "vault:backup:"), bk)
```

**State mutation guards during active processes:**
- `removeGuardian()` is blocked while `recoveryInitiatedAt != 0` — prevents a removed guardian's stale approval from counting toward the 2-of-3 threshold
- Pattern: when a state-changing circuit can invalidate assumptions of an in-progress process, block it during that process rather than trying to clean up inconsistencies

**Post-recovery terminal state:**
- After `claimRecovery()` succeeds, `recoveryComplete = true` is permanent. No reset circuit exists. Owner deploys a new GuardianRecovery instance for the next recovery cycle.
- `claimRecovery()` has an idempotency guard: `assert(!recoveryComplete, "Recovery already completed")` — prevents wasted gas on re-claims.

**Test counts (post-review):**
- Contract: 72 total (69 passed, 3 skipped — blockTimeGte simulator limitation)
- CLI API: 12 passed (8 circuit wrappers + 2 deploy/join + 2 ledger state query)

### 16. Shamir & RSA-OAEP Implementation Patterns (Story 3.2)

**Rule:** When using `secrets.js-34r7h` for Shamir Secret Sharing and RSA-OAEP for per-guardian share encryption, handle these non-obvious constraints:

**secrets.js-34r7h specifics:**
- Latest version is **2.0.2** (not 2.1.0 — does not exist on npm)
- Input to `secrets.share()` MUST be hex-encoded strings
- Output shares can have **odd-length hex strings** — downstream code must handle this
- No `@types` package exists — use a local `secrets-types.d.ts` declaration file

**RSA-OAEP 2048-bit + SHA-256 payload limit:**
- Maximum plaintext is **190 bytes** (256 - 2*32 - 2 = 190 with SHA-256)
- Text-encoding hex shares (1 byte per hex char) wastes half the capacity
- **Binary-encode** shares (`hexToUint8Array`) to double capacity (~160-char passwords vs ~66)
- Shamir shares with odd-length hex need a **1-byte flag prefix** to preserve the odd nibble:
```typescript
// Encode: [1 byte: isOdd flag][binary share data]
const isOdd = shareHex.length % 2 !== 0;
const paddedHex = isOdd ? '0' + shareHex : shareHex;
const shareData = hexToUint8Array(paddedHex);
const payload = new Uint8Array(1 + shareData.length);
payload[0] = isOdd ? 1 : 0;
payload.set(shareData, 1);

// Decode: check flag, strip leading zero if odd
const isOdd = decryptedArray[0] === 1;
const hex = bytesToHex(decryptedArray.slice(1));
return isOdd ? hex.slice(1) : hex;
```

**Web Crypto API TypeScript strict mode:**
- TS5+ strict mode does not assign `Uint8Array` to `BufferSource` (due to `SharedArrayBuffer` union)
- All `crypto.subtle.encrypt/decrypt/importKey` calls need `as BufferSource` cast on `Uint8Array` arguments

**RecoveryPersistProvider abstraction:**
- Platform-specific I/O (IPFS upload, contract calls) is abstracted behind an interface
- Enables pure unit testing with mocks — no live IPFS or blockchain needed
- Browser extension and guardian portal implement the interface differently
- **v2 change (ADR-007):** `persistRecoveryKey()` removed from interface — recovery key is ephemeral, derived from Shamir shares during recovery. No local storage of recovery key needed.

**Test counts:** 31 tests across 3 files (18 crypto, 7 setup, 6 persist). Full roundtrip test validates: setup → decrypt 2-of-3 shares → Shamir combine → verify hash → derive key → decrypt password.

### 17. Midnight Contract State Reading Patterns (Story 3.3/3.4)

**Rule:** There are TWO patterns for reading contract ledger state. Use the correct one depending on context.

**Pattern A — Initial snapshot via `deployTxData.public`:**
When you call `findDeployedContract()`, the returned `FoundContract` handle has `deployTxData.public` which contains `initialContractState: ContractState` — a snapshot of the contract's public ledger at deploy/join time.

```typescript
// After findDeployedContract() — reading INITIAL state
const contract = await findDeployedContract(providers, { ... });
const address = contract.deployTxData.public.contractAddress; // ✅ always available
```

**Pattern B — Fresh reads via `publicDataProvider.queryContractState()` + generated `ledger()` function:**
For CURRENT state (which may have changed since joining), use the public data provider and the contract's generated `ledger()` decoder function.

```typescript
// Reading CURRENT (live) ledger state — the recommended pattern
const contractState = await providers.publicDataProvider.queryContractState(contractAddress);
if (contractState == null) return null;
const ledgerState = GuardianRecovery.ledger(contractState.data); // ← generated decoder
// ledgerState.owner, ledgerState.guardians, ledgerState.recoveryComplete, etc.
```

**Why the cast is needed (SDK type limitation):**
- `deployTxData.public` is typed as `UnsubmittedDeployTxPublicData & FinalizedTxData`
- The `initialContractState` field is typed as opaque `ContractState`, not the contract-specific `Ledger` type
- At runtime, the ledger fields ARE present, but TypeScript generics don't propagate the contract-specific ledger type
- Either use the generated `ledger()` function to decode `ContractState`, or cast `as unknown as GuardianRecovery.Ledger`

**When to use which:**
- **Deploy tx metadata** (contractAddress, blockHeight, txId): always use `deployTxData.public` directly
- **Initial ledger snapshot**: cast `deployTxData.public as unknown as Ledger` is acceptable for one-time reads (e.g., guardian portal reading state at join time)
- **Live state during ongoing operations**: use `publicDataProvider.queryContractState()` + `ledger()` (recommended for any flow where state may have changed)

**References:**
- [UnsubmittedDeployTxPublicData](https://docs.midnight.network/develop/reference/midnight-api/midnight-js/@midnight-ntwrk/midnight-js-contracts/type-aliases/UnsubmittedDeployTxPublicData) — contains `contractAddress` and `initialContractState: ContractState`
- [PublicDataProvider](https://docs.midnight.network/develop/reference/midnight-api/midnight-js/@midnight-ntwrk/midnight-js-types/interfaces/PublicDataProvider) — `queryContractState()` for fresh reads
- [Viewing Contract State tutorial](https://docs.midnight.network/develop/tutorial/building/dapp-details#viewing-contract-state) — CLI uses `publicDataProvider` + generated `ledger()` function
- [Top-level exports](https://docs.midnight.network/develop/reference/compact/lang-ref#top-level-exports) — exported ledger fields are visible via the generated TypeScript `ledger()` function

### 18. Midnight SDK Research — Multiple Reference Projects (CRITICAL)

**Rule:** When writing stories or implementing features that involve Midnight SDK integration (provider wiring, contract interaction, WASM bundling, Lace wallet connection, Vite configuration), research a **minimum of 8 reference projects** (both official and community). Never rely solely on the bboard example.

**Why this matters:**
- The bboard example is the only official Midnight Foundation browser DApp, but it reflects ONE pattern for ONE use case
- Community projects (midnight-bank, midnight-game-2, MeshJS template, naval-battle-game, zkBadge, midnames) often demonstrate patterns closer to our specific needs (e.g., read-only mode, progressive wallet connection, join-existing-contract flows)
- Different projects use different Lace connector API versions (v1.x vs v4.x), private state strategies (in-memory vs persistent), and proof server URI sources
- Relying on a single example leads to incorrect assumptions — e.g., assuming all browser DApps use `levelPrivateStateProvider` when half use `inMemoryPrivateStateProvider`

**Research protocol:**
1. **Start with official examples:** bboard (browser), counter (CLI), midnight-js testkit
2. **Check community projects:** midnight-bank, midnight-game-2, MeshJS/midnight-starter-template, naval-battle-game, midnames, zkBadge
3. **Cross-reference patterns:** Build a comparison table showing how each project handles the specific concern (provider wiring, wallet connection, private state, etc.)
4. **Identify consensus vs divergence:** When 6+ projects agree on a pattern, it's reliable. When projects diverge, document both approaches with rationale for our choice.
5. **Use MCP tools:** `midnight-search-typescript`, `midnight-search-compact`, `midnight-get-file` can pull code from indexed repositories

**Anti-pattern:**
```
// ❌ WRONG: "Based on the bboard example, we should use levelPrivateStateProvider"
//    (Only checked 1 project — 3 of 6 browser DApps actually use inMemoryPrivateStateProvider)

// ❌ WRONG: "The proof server URI comes from config"
//    (bboard and MeshJS get it from Lace wallet's getConfiguration() — config is fallback only)
```

**Correct pattern:**
```
// ✅ CORRECT: "Cross-referencing 8 projects (bboard, midnight-bank, MeshJS, midnight-game-2,
//    naval-battle, midnames, midnight-js testkit, midnight-game-2-batcher):
//    - inMemoryPrivateStateProvider: bboard, MeshJS, naval-battle (ephemeral state)
//    - levelPrivateStateProvider: midnight-bank, midnight-game-2 (persistent state)
//    - Decision: inMemoryPrivateStateProvider — guardian portal's private state is ephemeral"
```

**Discovery:** Story 3.7 — initial story only referenced bboard for provider wiring. Research across 8 projects revealed critical patterns (read-only stubs, progressive wallet connection, in-memory vs persistent private state, v1 vs v4 Lace API) that were invisible from a single example.

### 19. Browser Extension Import Constraints — Vite Transform-Time Resolution (Story 3.6)

**Rule:** Browser extension TSX components CANNOT import `@aliasvault/contract` directly. Vite's `import-analysis` plugin resolves imports at transform time (before `vi.mock` intercepts), causing build failures. Use **service wrapper functions with dynamic imports** instead.

**Why this matters:**
- `@aliasvault/contract` is a workspace package not listed in the browser extension's `package.json` — Vite cannot resolve it
- Even if the import is inside a `vi.mock` block in tests, Vite processes the source file's imports first
- Dynamic `import()` inside service functions defers resolution to runtime, bypassing Vite's static analysis

**Anti-pattern:**
```typescript
// ❌ WRONG: Direct import in TSX component
import { VaultRegistry } from '@aliasvault/contract';

const commitment = VaultRegistry.pureCircuits.backupCommitment(key);
```

**Correct pattern:**
```typescript
// ✅ CORRECT: Service wrapper with dynamic import
// BackupWalletService.ts
export async function computeBackupCommitment(backupKey: Uint8Array): Promise<Uint8Array> {
  const { VaultRegistry } = await import('@aliasvault/contract');
  return VaultRegistry.pureCircuits.backupCommitment(backupKey);
}

// BackupTransfer.tsx — import from service, not contract
import { computeBackupCommitment } from '@/services/BackupWalletService';
```

**In tests:** Mock the service function, not the contract package:
```typescript
vi.mock('@/services/BackupWalletService', () => ({
  computeBackupCommitment: vi.fn().mockResolvedValue(new Uint8Array(32)),
}));
```

### 20. Hex Validation — Silent Data Corruption Risk (Story 3.6)

**Rule:** Always validate hex strings with a regex (`/^[0-9a-fA-F]*$/`) BEFORE calling `parseInt(hex, 16)`. Without validation, `parseInt("gg", 16)` returns `NaN`, and `Uint8Array` silently coerces `NaN` to `0` — producing incorrect bytes that could permanently lock a vault via an unreachable commitment.

**Canonical implementation** in `apps/browser-extension/src/utils/hex.ts`:
```typescript
const HEX_REGEX = /^[0-9a-fA-F]*$/;

export function isValidHex(hex: string, expectedLength?: number): boolean {
  if (expectedLength !== undefined && hex.length !== expectedLength) return false;
  return hex.length % 2 === 0 && HEX_REGEX.test(hex);
}

export function hexToBytes(hex: string): Uint8Array {
  if (!isValidHex(hex)) throw new Error('Invalid hex string');
  // ... safe parseInt after validation
}
```

**Why this matters:**
- User enters backup key `"gg".repeat(32)` (non-hex chars) → `hexToBytes` produces all-zeros commitment
- Contract stores the all-zeros commitment → no real key maps to it → wallet permanently unrecoverable
- This is a **silent** failure — no error thrown, no warning shown

**Pattern:** Validate at system boundaries (user input, external data). Internal hex strings (from `bytesToHex`) are trusted.

### 21. VaultCidStore Secret Key Access from Popup Pages (Story 3.6)

**Rule:** Browser extension popup pages can access the vault owner's secret key via `VaultCidStore.getSecretKey()`. This returns the hex-encoded secret key from `chrome.storage.local`, which was cached there during vault unlock by `DbContext.extractAndCacheSecretKey()`.

**Two architecture patterns for contract interaction in the extension:**
1. **Background messages** — For heavy/cached operations (vault save/load). Popup sends message → background script handles contract call.
2. **Direct service calls** — For one-off operations (backup wallet add/remove, recovery claim). Popup page calls service directly, service reads secret key from `VaultCidStore`.

**When to use which:**
- Background messages: When you need the full `DbContext` (SQLite DB handle, cached state)
- Direct service calls: When you only need the secret key for owner authentication + a contract call

**Example (direct service call pattern):**
```typescript
import { VaultCidStore } from '@/services/VaultCidStore';
import { hexToBytes } from '@/utils/hex';

async function getSecretKeyBytes(): Promise<Uint8Array> {
  const secretKeyHex = await VaultCidStore.getSecretKey();
  if (!secretKeyHex) throw new Error('Vault not unlocked — secret key unavailable');
  return hexToBytes(secretKeyHex);
}
```

### 22. Guardian Portal Production Build Verification (Story 3.7)

**Rule:** Any story touching `services/guardian-portal/` must verify the production build passes alongside TypeScript checks and tests.

**Verification triple:**
```bash
cd services/guardian-portal
npx tsc -b --noEmit          # TypeScript type check
pnpm run test                 # 117 Vitest tests
pnpm run build                # Vite 7 production build → dist/
```

**Why this matters:**
- The portal bundles two large WASM modules (`ledger-v7` 10.4 MB, `onchain-runtime-v2` 1.4 MB) that require `vite-plugin-wasm` + `vite-plugin-top-level-await`
- Rollup's module resolution differs from TypeScript — a file that passes `tsc` can fail Vite build (e.g., CJS named exports, transitive dep resolution under pnpm strict hoisting)
- ZK circuit keys (`keys/`, `zkir/`) are copied from the compiled contract into `public/` during build — missing keys would cause silent runtime failures in `FetchZkConfigProvider`

**Build output expectations:**
- `dist/index.html` + 2 JS bundles + 2 `.wasm` files + 32 ZK key files
- Total ~34 MB (WASM + ZK prover keys dominate)
- `fs`/`path` externalization warnings from `midnight-js-contracts` are expected (dead code from CJS→ESM transpilation)

**Discovery:** Story 3.7 — `tsc --noEmit` passed but `vite build` failed due to WASM ESM integration, CJS named export resolution, and pnpm-specific transitive dependency issues. All three checks are needed.

---

## Development Workflow Rules

### Monorepo Package Dependencies

**Rule:** Use workspace protocol (`workspace:*`) for internal package dependencies.

**Example `package.json`:**
```json
{
  "dependencies": {
    "@aliasvault/shared": "workspace:*",
    "@aliasvault/contracts": "workspace:*"
  }
}
```

### TurboRepo Build Caching

**Rule:** Enable caching for all build and test tasks to speed up CI.

**Why this matters:** 10x faster builds in CI (documented in ADR-006).

**turbo.json configuration:**
```json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "build/**"],
      "cache": true  // REQUIRED
    },
    "test": {
      "dependsOn": ["build"],
      "cache": true,
      "inputs": ["src/**", "__tests__/**"]
    }
  }
}
```

---

## Anti-Patterns to Avoid

### ❌ Direct Wallet Encryption of Master Password

**Never** encrypt the master password directly with the wallet address. Always use the wallet-independent recovery key pattern (see Rule 1).

### ❌ Skipping CIDv1 Type Guard

**Never** store an IPFS CID without calling `assertCIDv1()` first. CIDv0 CIDs will break contract storage (see Rule 2).

### ❌ Business Logic in App Services

**Never** implement business logic in `apps/*/src/services/`. Extract to `shared/logic/` immediately (see Rule 3).

### ❌ Manual Contract Address Strings

**Never** hardcode contract addresses as string literals. Import from `shared/config/contracts.ts` (see Rule 4).

### ❌ Guardian Recovery Without Time-Lock Awareness

**Never** assume guardian shares are claimable immediately after approvals. Always respect the 72-hour time-lock (see Rule 6).

### ❌ Device-Local-Only Storage of Cross-Device Secrets

**Never** store the VaultRegistry `secretKey` (or any cross-device secret) solely in `chrome.storage.local` or Midnight private state. Always store in the encrypted vault DB so it syncs via IPFS (see Rule 12).

---

## Code Quality Standards

### Type Safety

- **Strict TypeScript mode**: `strict: true` in `tsconfig.json`
- **No `any` types**: Use `unknown` and type guards instead
- **Branded types**: Use for domain primitives (CIDv1String, WalletAddress, etc.)

### Testing Requirements

- **Unit test coverage**: Minimum 80% for `shared/logic/`
- **Integration tests**: Required for all service boundaries
- **E2E tests**: Required for critical user journeys (onboarding, vault operations, recovery flow)
- **Chaos testing**: Required for guardian recovery (35+ scenarios documented in Pattern 6)

### Documentation

- **ADR format**: Use Architecture Decision Records for all major decisions
- **Code comments**: Explain WHY, not WHAT
- **README per package**: Document package purpose and dev setup

---

## Security Checklist

Before merging any PR that touches cryptography or guardian recovery:

- [ ] Zero-knowledge principles maintained (no plaintext master password in contracts)
- [ ] Recovery key hash (`SHA-256(shamirSecret)`) stored on public ledger for verification; actual recovery key is ephemeral (ADR-007), derived from Shamir shares during recovery — NOT stored in vault blob or Midnight private state
- [ ] CIDv1 format enforced with type guards
- [ ] Guardian shares encrypted with RSA-OAEP
- [ ] Time-lock logic tested with multiple scenarios
- [ ] Contract address imports from shared config only
- [ ] No hardcoded secrets or API keys

---

**Last Updated:** 2026-03-01
**Source:** Generated from [architecture.md](_bmad-output/architecture.md)
**Maintenance:** Update when implementing new patterns or discovering critical rules
**Change Log:**
- 2026-03-01: Added Rule 22 (Guardian Portal Production Build Verification) from Story 3.7. Vite build must pass alongside tsc and vitest for any changes to services/guardian-portal/. Documents WASM plugin requirements, ZK key copying, and build output expectations.
- 2026-03-01: Added Rules 19-21 from Story 3.6 (Backup Wallet Configuration & Transfer). Rule 19: Browser extension Vite transform-time resolution — TSX components cannot import `@aliasvault/contract` directly, must use service wrappers with dynamic imports. Rule 20: Hex validation — `parseInt("gg", 16)` returns NaN, Uint8Array coerces to 0, causing silent data corruption. Canonical `utils/hex.ts` with regex validation. Rule 21: VaultCidStore secret key access from popup pages — two architecture patterns (background messages vs direct service calls). Updated Rule 11: confirmed `blockTimeGte()` always returns true in simulator (not just suspected).
- 2026-02-28: Added Rule 17 (Midnight contract state reading patterns). Two patterns: `deployTxData.public` for initial snapshot vs `publicDataProvider.queryContractState()` + generated `ledger()` for fresh reads. Documented SDK type limitation where `ContractState` is opaque and requires cast or `ledger()` decoder. Added `typescript` as direct devDependency to contract + cli packages (bare `tsc` in build scripts requires it). Aligned guardian-portal `compact-js` version 0.14.0 → 2.4.0 to match CLI.
- 2026-02-24: Added `services/*` to pnpm workspace list (Story 3.3 Guardian Portal). Updated test counts for Story 3.2v2 (31 tests across 3 files). Updated date.
- 2026-02-22: **ADR-007 — Pattern 6 v2 (Inverted Shamir).** Rewrote Rule 1 to reflect ephemeral recovery key architecture. Updated Rule 16 and Security Checklist. Recovery key is no longer stored anywhere — derived from Shamir shares during recovery. Eliminates circular dependency (vault blob encrypted with lost master password) and ADR-006 private state device-local limitation. Sources: [Web3Auth/MetaMask SSS](https://docs.metamask.io/embedded-wallets/infrastructure/sss-architecture/), [ANARKey](https://eprint.iacr.org/2025/551), [Argent recovery](https://support.argent.xyz/hc/en-us/articles/360022631412-About-wallet-recovery).
- 2026-02-22: Added Rule 16 (Shamir & RSA-OAEP implementation patterns) from Story 3.2. secrets.js-34r7h v2.0.2 specifics, odd-length hex handling with 1-byte flag prefix for binary RSA payloads, RSA-OAEP 190-byte limit workaround, TS5+ BufferSource cast requirement, RecoveryPersistProvider abstraction pattern.
- 2026-02-21: Added Rule 15 (GuardianRecovery contract patterns) from Story 3.1. Per-vault deployment model, guardian-specific domain separators, state mutation guards during active recovery, post-recovery terminal state, and idempotency guard on claimRecovery.
- 2026-02-08: Added Rule 14 (Compact Set limitations, sentinel values, multi-role domain separators) from Story 2.6. Updated Rule 11 simulator pattern with backupKey param, multi-role testing, and block-time limitation note.
- 2026-02-08: Updated Rule 10 with `blockTimeGte/Gt/Lt/Lte(Uint<64>)` discovery (Compact 0.17+) and `Uint<64>` arithmetic cast pattern. Fixed Security Checklist recovery key storage (ADR-006). From Story 2.6 validation.
- 2026-02-08: Added Rule 13 (pnpm strict hoisting & transitive dependencies) from Story 2.5. pnpm doesn't hoist transitive deps — packages must declare explicit dependencies for modules they import directly.
- 2026-02-07: Added Rules 9-11 (Compact ownership pattern, language gotchas, contract testing) from Story 2.1 implementation
- 2026-02-07: Updated Rules 2, 3, 5 with Story 2.2 learnings (canonical assertCIDv1 location, actual IPFS error codes, shared package structure). Updated storage stack (ipfs-http-client → pinata SDK). Added shared/* to pnpm workspace note.
- 2026-02-07: Added Rule 12 (Midnight Private State is Device-Local, ADR-006) from Story 2.3 architectural analysis. Midnight private state does NOT sync across devices — secrets must be stored in encrypted vault blob.
