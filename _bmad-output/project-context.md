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
- pnpm 8+ (monorepo workspace — `packages/*`, `packages/blockchain/*`, `shared/*`)
- TurboRepo (build orchestration with caching)
- Shared packages built with `tsup` (CJS + ESM + DTS), distributed via `build.sh` scripts

**Testing:**
- Jest / Vitest (unit tests)
- Playwright / Cypress (E2E tests for extension)

---

## Critical Implementation Rules

### 1. Wallet-Independent Recovery Key (CRITICAL - Pattern 6)

**Rule:** The master password is encrypted with a wallet-independent recovery key stored in the Midnight contract's PRIVATE state, NOT directly with the wallet.

**Why this matters:**
- ❌ **WRONG:** Encrypting master password directly with wallet → catastrophic loss if wallet lost
- ✅ **CORRECT:** Encrypt with recovery key → store recovery key in contract → backup wallet can transfer ownership

**Implementation:**
```typescript
// CORRECT: Dual-layer encryption
const recoveryKey = generateRecoveryKey() // AES-256 key
const encryptedPassword = aesEncrypt(masterPassword, recoveryKey)
const shares = shamirSplit(encryptedPassword, 2, 3) // Split encrypted password
const guardianShares = shares.map((share, i) => 
  rsaEncrypt(share, guardians[i].publicKey)
)

// Store recovery key in Midnight private state
await contract.storeRecoveryKey(recoveryKey)
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
  constructor(secretKey: Uint8Array) {
    this.contract = new Contract<VaultRegistryPrivateState>(vaultRegistryWitnesses);
    const initialPrivateState = createVaultRegistryPrivateState(secretKey);
    // ... createConstructorContext, createCircuitContext
  }
  public registerVault(hash: Uint8Array): Ledger { /* impureCircuits.registerVault */ }
  public static ownerCommitment(sk: Uint8Array): Uint8Array {
    return pureCircuits.ownerCommitment(sk);  // Off-circuit verification
  }
}
```

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
- [ ] Recovery key stored in Midnight PRIVATE state, not public
- [ ] CIDv1 format enforced with type guards
- [ ] Guardian shares encrypted with RSA-OAEP
- [ ] Time-lock logic tested with multiple scenarios
- [ ] Contract address imports from shared config only
- [ ] No hardcoded secrets or API keys

---

**Last Updated:** 2026-02-08
**Source:** Generated from [architecture.md](_bmad-output/architecture.md)
**Maintenance:** Update when implementing new patterns or discovering critical rules
**Change Log:**
- 2026-02-08: Added Rule 13 (pnpm strict hoisting & transitive dependencies) from Story 2.5. pnpm doesn't hoist transitive deps — packages must declare explicit dependencies for modules they import directly.
- 2026-02-07: Added Rules 9-11 (Compact ownership pattern, language gotchas, contract testing) from Story 2.1 implementation
- 2026-02-07: Updated Rules 2, 3, 5 with Story 2.2 learnings (canonical assertCIDv1 location, actual IPFS error codes, shared package structure). Updated storage stack (ipfs-http-client → pinata SDK). Added shared/* to pnpm workspace note.
- 2026-02-07: Added Rule 12 (Midnight Private State is Device-Local, ADR-006) from Story 2.3 architectural analysis. Midnight private state does NOT sync across devices — secrets must be stored in encrypted vault blob.
