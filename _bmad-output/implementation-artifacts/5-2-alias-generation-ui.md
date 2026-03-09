# Story 5.2: Alias Generation UI

Status: review

## Story

As a user,
I want to generate a new email alias from my browser extension,
so that I can sign up for services without revealing my real email.

## Acceptance Criteria

1. "Generate Alias" button visible on extension popup (new route/page for alias creation)
2. Custom alias name input with real-time validation (3-64 chars, alphanumeric + hyphen, lowercase)
3. Auto-generate random alias option (e.g., `zk-tiger-7842@alias.id`)
4. Wallet signature required to claim alias on-chain (via `AliasRegistry.claimAlias()`)
5. On first alias claim: generate X25519 keypair, call `setEmailPublicKey(publicKey)` and `setMailRelay(bridgeRelayCommitment)` on user's VaultRegistry
6. Success: show new alias, copy-to-clipboard button
7. Error: display if alias already claimed (or other contract errors)

## Tasks / Subtasks

- [x] Task 1: Alias service wrapper (AC: #4, #5, #7)
  - [x] 1.1 Create `AliasService.ts` in `apps/browser-extension/src/services/` — wrapper around AliasRegistry contract interactions using dynamic `await import()` (Rule 19)
  - [x] 1.2 Implement `claimAlias(aliasName: string, secretKey: Uint8Array, vaultContractAddr: string)` — hashes `aliasName@alias.id` via SHA-256 to `Bytes<32>`, calls `AliasRegistry.claimAlias(aliasHash, contractAddr)`
  - [x] 1.3 Implement `checkAliasAvailable(aliasName: string)` — hashes alias, calls `AliasRegistry.getOwner(aliasHash)`, returns `true` if owner is zero-bytes (unclaimed)
  - [x] 1.4 Implement `releaseAlias(aliasName: string, secretKey: Uint8Array)` — for future use by Story 5.8
  - [x] 1.5 Add `AliasRegistry` contract join logic following `MidnightContractService.joinVaultRegistry()` pattern — `findDeployedContract` with `aliasRegistryWitnesses` and `AliasRegistryPrivateState`
  - [x] 1.6 Add `setMailRelay(bridgeRelayCommitment: Uint8Array)` call on VaultRegistry (extend existing `MidnightContractService`)
  - [x] 1.7 Add `setEmailPublicKey(publicKey: Uint8Array)` call on VaultRegistry (extend existing `MidnightContractService`)

- [x] Task 2: X25519 keypair generation & storage (AC: #5)
  - [x] 2.1 Add `generateEmailKeyPair()` utility using `tweetnacl` (`nacl.box.keyPair()`) — returns `{ publicKey: Uint8Array, secretKey: Uint8Array }`
  - [x] 2.2 Store keypair in VaultJson `settings` as `emailPublicKey` (hex) and `emailPrivateKey` (hex) — vault is encrypted at rest so private key is safe
  - [x] 2.3 On first alias claim: check if keypair exists in vault settings; if not, generate and store
  - [x] 2.4 Call `setEmailPublicKey(publicKey)` on VaultRegistry after generating keypair

- [x] Task 3: Alias name validation & generation (AC: #2, #3)
  - [x] 3.1 Create `aliasUtils.ts` in `apps/browser-extension/src/utils/` with:
    - `validateAliasName(name: string): { valid: boolean; error?: string }` — 3-64 chars, `/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/` (no leading/trailing hyphens, no consecutive hyphens)
    - `generateRandomAlias(): string` — pattern `{adjective}-{noun}-{4digits}` (e.g., `zk-tiger-7842`)
    - `hashAlias(localPart: string, domain: string): Uint8Array` — SHA-256 of `${localPart}@${domain}` → 32 bytes
  - [x] 3.2 Domain constant: `ALIAS_DOMAIN = 'alias.id'`

- [x] Task 4: "Generate Alias" page (AC: #1, #2, #3, #6, #7)
  - [x] 4.1 Create `AliasGenerate.tsx` in `apps/browser-extension/src/entrypoints/popup/pages/aliases/`
  - [x] 4.2 Form layout:
    - Alias name input (`FormInput`) with real-time validation and `@alias.id` suffix display
    - "Random" button to auto-fill with `generateRandomAlias()`
    - Availability check indicator (debounced `checkAliasAvailable` on input change, ~500ms)
    - "Claim Alias" submit button (disabled until valid + available)
  - [x] 4.3 Submit flow:
    1. Get secret key via `VaultCidStore.getSecretKey()` (Rule 21)
    2. Check if `emailPublicKey` exists in vault settings → if not, generate keypair (Task 2)
    3. Check if `mailRelay` is set on VaultRegistry → if not, call `setMailRelay(BRIDGE_RELAY_COMMITMENT)`
    4. Call `setEmailPublicKey(publicKey)` if keypair was just generated
    5. Hash alias name, call `AliasRegistry.claimAlias(aliasHash, vaultContractAddr)`
    6. On success: store alias in VaultJson credential entry, show success with copy-to-clipboard
    7. On error: display error message (alias already claimed, wallet rejected, network error)
  - [x] 4.4 Success view: display new alias email, `FormInputCopyToClipboard` component, "Done" button to navigate back
  - [x] 4.5 Error handling: display contract errors (already claimed, not owner) and network errors with user-friendly messages

- [x] Task 5: Route registration & navigation (AC: #1)
  - [x] 5.1 Add route `/aliases/generate` in `App.tsx` with `LayoutType.DEFAULT`, title "Generate Alias", back button
  - [x] 5.2 Add navigation entry point — "Generate Alias" button on credentials list or a new nav item (follow existing UI patterns for discoverability)

- [x] Task 6: Alias storage in VaultJson (AC: #6)
  - [x] 6.1 Create a new `CredentialTree` entry per alias with:
    - `id`: UUID
    - `serviceName`: `"Email Alias"` or the alias name
    - `alias.email`: `${aliasName}@alias.id`
    - `createdAt` / `updatedAt`: current timestamp
    - Other fields empty/default
  - [x] 6.2 Use `useVaultMutate` hook to save — follows existing credential mutation pattern (encrypt → upload → sync)

- [x] Task 7: Bridge relay commitment config (AC: #5)
  - [x] 7.1 Store bridge relay commitment as a constant or config value — in MVP this is a well-known testnet value published by the bridge operator
  - [x] 7.2 Create `config/bridge.ts` or add to existing config with `BRIDGE_RELAY_COMMITMENT: Uint8Array` (32 bytes, hex-encoded source)
  - [x] 7.3 Validate hex before converting (Rule 20 — use canonical `hex.ts` pattern)

- [x] Task 8: Update ambient declarations (AC: all)
  - [x] 8.1 Update `externals.d.ts` (Rule 24) if new types are exported from `@aliasvault/contract` (AliasRegistry types, witnesses)
  - [x] 8.2 Add `tweetnacl` ambient declaration if not already present

- [x] Task 9: Tests (AC: all)
  - [x] 9.1 Unit tests for `aliasUtils.ts` — validation rules, random generation, hashing
  - [x] 9.2 Unit tests for `AliasService.ts` — mock contract calls, test claim/check/release flows
  - [x] 9.3 Component tests for `AliasGenerate.tsx` — mock AliasService, test form validation, submit flow, success/error states
  - [x] 9.4 Verify `tsc --noEmit` passes from extension root

## Dev Notes

### Architecture Constraints

- **Dynamic imports only** (Rule 19): All `@aliasvault/contract` and `@midnight-ntwrk/*` imports MUST use `await import()` inside service functions. TSX components import the service wrapper, never the contract package directly.
- **Hex validation** (Rule 20): Any hex string → `parseInt` conversion MUST validate with regex first. Use `apps/browser-extension/src/utils/hex.ts` canonical pattern.
- **Secret key access** (Rule 21): Use `VaultCidStore.getSecretKey()` from popup pages. Heavy contract calls go through background messages; light reads can be direct service calls.
- **Ambient declarations** (Rule 24): Runtime-only packages declared in `externals.d.ts`. Update if adding new contract type imports.
- **Workspace topology**: `apps/*` is NOT in `pnpm-workspace.yaml`. Cannot use `workspace:*` deps. Use dynamic imports for `@aliasvault/contract`.

### Contract API Reference

**AliasRegistry** (from Story 5.1 — `packages/blockchain/contract/src/alias-registry.compact`):
- `claimAlias(aliasHash: Bytes<32>, contractAddr: Opaque<'string'>)` — claims alias for caller (owner commitment stored automatically)
- `getOwner(aliasHash: Bytes<32>) → Bytes<32>` — returns owner commitment (zero-bytes if unclaimed)
- `getContractAddress(aliasHash: Bytes<32>) → Opaque<'string'>` — returns vault contract address
- `releaseAlias(aliasHash: Bytes<32>)` — owner-only release
- Witness: `local_secret_key(): Bytes<32>` — same secret key pattern as VaultRegistry
- Domain separator: `"alias:owner:"` — different from `"vault:owner:"`, same key produces different commitments

**VaultRegistry** (extended by Story 5.0):
- `setEmailPublicKey(pubKey: Bytes<32>)` — owner-only, stores X25519 public key on-chain
- `setMailRelay(relayCommit: Bytes<32>)` — owner-only, authorizes bridge relay
- Existing: `updateVault(cidHash: Bytes<32>)`, `transferOwnership(...)`, etc.

**TypeScript API mapping** (confirmed in Story 5.0/5.1):
- `Bytes<32>` → `Uint8Array` (32 bytes)
- `Opaque<'string'>` → `string`
- `Counter` → read via `getLedger().totalClaimCount.value`

### Alias Hashing

Client-side alias hashing (both extension and bridge use same algorithm):
```
SHA-256( "${localPart}@${domain}" ) → Uint8Array(32)
```
Use `crypto.subtle.digest('SHA-256', ...)` in browser. Canonical implementation goes in `aliasUtils.ts`.

### First-Alias-Claim Flow (Multi-Step Transaction)

On the user's FIRST alias claim, three on-chain operations are needed:
1. **Generate X25519 keypair** → store in VaultJson settings → call `setEmailPublicKey(pubKey)` on VaultRegistry
2. **Set mail relay** → call `setMailRelay(BRIDGE_RELAY_COMMITMENT)` on VaultRegistry
3. **Claim alias** → call `claimAlias(aliasHash, vaultContractAddr)` on AliasRegistry

Subsequent alias claims only need step 3 (check emailPublicKey and mailRelay are already set).

Each call is a separate transaction requiring wallet signature. Show progress to user (step indicator or sequential loading states).

### AliasRegistry Contract Join Pattern

Follow `MidnightContractService.joinVaultRegistry()` exactly:
```typescript
const { findDeployedContract } = await import('@midnight-ntwrk/midnight-js-contracts');
const { AliasRegistry, aliasRegistryWitnesses, createAliasRegistryPrivateState } =
  await import('@aliasvault/contract');

const contract = await findDeployedContract(providers, {
  contractAddress: ALIAS_REGISTRY_ADDRESS,
  compiledContract: AliasRegistry,
  privateStateId: 'aliasRegistryPrivateState',
  initialPrivateState: createAliasRegistryPrivateState(secretKey),
});
```

The AliasRegistry is a **singleton global contract** (one address for all users), unlike per-user VaultRegistry instances. The contract address is a config constant.

### VaultJson Storage Pattern

Store each claimed alias as a `CredentialTree` entry:
```typescript
const newCredential: CredentialTree = {
  id: crypto.randomUUID(),
  serviceName: aliasName, // or "Email Alias"
  alias: { email: `${aliasName}@alias.id` },
  password: { value: '', history: [] },
  attachments: [],
  totpCodes: [],
  passkeys: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  isDeleted: false,
};
```

Use `useVaultMutate` to save — this handles encrypt → IPFS upload → contract CID update atomically.

### Existing Code to Reuse

| What | Where | Notes |
|------|-------|-------|
| `FormInput` | `popup/components/Forms/FormInput.tsx` | Text input with validation |
| `FormInputCopyToClipboard` | `popup/components/Forms/FormInputCopyToClipboard.tsx` | Read-only + copy |
| `Modal` | `popup/components/Dialogs/Modal.tsx` | Confirmation dialogs |
| `useVaultMutate` | `popup/hooks/useVaultMutate.ts` | Vault mutation + sync |
| `VaultCidStore.getSecretKey()` | `services/VaultCidStore.ts` | Owner secret key |
| `MidnightContractService` | `services/MidnightContractService.ts` | Contract interaction base |
| `hex.ts` | `utils/hex.ts` | Hex validation (Rule 20) |
| Routing pattern | `App.tsx` routes | `LayoutType.DEFAULT` + back button |
| `AliasBlock.tsx` | `popup/components/Credentials/Details/AliasBlock.tsx` | Alias display reference |

### Anti-Patterns to Avoid

- **DO NOT** import `@aliasvault/contract` or `@midnight-ntwrk/*` directly in TSX — use service wrappers with `await import()` (Rule 19)
- **DO NOT** use `parseInt(hex, 16)` without regex validation first (Rule 20) — silent data corruption risk
- **DO NOT** store alias data in SQLite or separate DB — vault format is VaultJson (Rule 23)
- **DO NOT** create a separate alias storage outside VaultJson — aliases are `CredentialTree` entries with `alias.email` populated
- **DO NOT** assume `Map.lookup()` returns zero-bytes for unclaimed — in simulator it throws; use `member()` check or catch errors

### Project Structure Notes

New files:
```
apps/browser-extension/src/
  services/AliasService.ts                    # AliasRegistry contract wrapper
  utils/aliasUtils.ts                         # Validation, random gen, hashing
  entrypoints/popup/pages/aliases/
    AliasGenerate.tsx                          # Generate alias page
  config/bridge.ts                            # Bridge relay commitment constant
```

Modified files:
```
apps/browser-extension/src/
  services/MidnightContractService.ts         # Add setMailRelay, setEmailPublicKey
  entrypoints/popup/App.tsx                   # Add /aliases/generate route
  types/externals.d.ts                        # Add AliasRegistry ambient types
```

### References

- [Source: _bmad-output/epics.md — Epic 5, Story 5.2]
- [Source: _bmad-output/implementation-artifacts/5-0-email-keypair-relay-authorization.md — X25519 keypair deferral to 5.2]
- [Source: _bmad-output/implementation-artifacts/5-1-aliasregistry-smart-contract.md — Contract API, patterns]
- [Source: docs/architecture/adr-008-email-encryption-x25519.md — Keypair generation, tweetnacl]
- [Source: docs/architecture/adr-009-email-notification-on-chain.md — setMailRelay, relay commitment]
- [Source: _bmad-output/project-context.md — Rules 19, 20, 21, 23, 24, 25]
- [Source: _bmad-output/implementation-artifacts/sprint-change-proposal-2026-03-05.md — Updated ACs, NIGHT fee removed]
- [Source: packages/blockchain/contract/src/alias-registry.compact — Contract source]
- [Source: packages/blockchain/contract/src/vault-registry.compact — Email circuits (5.0)]

### Previous Story Intelligence

**From Story 5.1 (AliasRegistry Contract):**
- `ownerCommitment` in AliasRegistry uses `"alias:owner:"` domain separator — NOT the same as VaultRegistry's `"vault:owner:"`. Same secret key produces different commitments. This is intentional for cross-contract identity isolation.
- `Map.lookup()` in simulator throws for non-existent keys (different from on-chain default). When checking alias availability, use `getLedger().aliasOwners.member(aliasHash)` or catch the error.
- `Opaque<'string'>` (contract address) maps to `string` in TypeScript API.
- Code review applied: `totalAliases` renamed to `totalClaimCount` (monotonic, never decrements on release).

**From Story 5.0 (Email Keypair & Relay Authorization):**
- `setEmailPublicKey` and `setMailRelay` are owner-only circuits requiring `local_secret_key()` witness.
- Relay commitment uses `persistentCommit<Bytes<32>>(pad(32, "vault:relay:"), rk)` — same pattern as owner/backup commitments.
- `emailCount` is a monotonic `Counter` (cannot decrement). `inboxManifestCid` is `Opaque<'string'>` (maps to `string`).
- Tests confirm 49 vault-registry tests pass (45 + 4 skipped blockTimeGte). Zero regressions from email circuit additions.

**From Story 4.3 (Conflict Detection UX):**
- `useVaultMutate` handles merge notifications with 3-second display hold via `useRef`.
- `encryptOrThrow()` pattern for wrapping encryption errors.
- `externals.d.ts` must be updated when shared packages export new types.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- tsc --noEmit: zero source errors (only pre-existing wxt.config.ts vite version mismatch)
- Full test suite: 295 passed, 8 failed (all 8 pre-existing FormFiller/FormDetector date-related failures)
- New tests: 43 total (9 AliasService + 18 aliasUtils + 10 emailKeyPair + 6 AliasGenerate component)

### Completion Notes List

- Task 1: Created AliasService.ts with claimAlias, checkAliasAvailable, releaseAlias. Extended MidnightContractService with setEmailPublicKey, setMailRelay, readEmailPublicKey, readMailRelay. Added AliasRegistry exports to contract package index.ts. Added AliasRegistry address placeholder to shared/config/contracts.ts.
- Task 2: Created emailKeyPair.ts utility using tweetnacl nacl.box.keyPair(). Generates X25519 keypair, stores/retrieves from VaultJson settings as hex. Added tweetnacl v1.0.3 as extension dependency.
- Task 3: Created aliasUtils.ts with validateAliasName (3-64 chars, lowercase alphanumeric + hyphen, no consecutive/edge hyphens), generateRandomAlias (adjective-noun-4digits pattern), hashAlias (SHA-256 of localPart@domain).
- Task 4: Created AliasGenerate.tsx page with: alias name input with real-time validation, @alias.id suffix display, debounced availability check (500ms), random alias button, multi-step claim flow (keypair→relay→pubkey→claim→save), success view with FormInputCopyToClipboard, error handling for claimed/rejected/network errors.
- Task 5: Added /aliases/generate route in App.tsx with LayoutType.DEFAULT and back button. Added EMAIL header icon and "Generate Alias" button to CredentialsList header.
- Task 6: Alias stored as CredentialTree entry with serviceName=aliasName, alias.email=aliasName@alias.id via useVaultMutate.
- Task 7: Created config/bridge.ts with BRIDGE_RELAY_COMMITMENT constant (hex-validated per Rule 20). MVP placeholder value (zero bytes) — replace with actual bridge operator commitment when deployed.
- Task 8: No changes needed — @aliasvault/contract already declared in externals.d.ts, tweetnacl has built-in TypeScript types.
- Task 9: 43 tests total covering services, utilities, and component. tsc --noEmit passes (zero source errors).

### File List

**New files:**
- `apps/browser-extension/src/services/AliasService.ts` — AliasRegistry contract wrapper
- `apps/browser-extension/src/services/__tests__/AliasService.test.ts` — 9 tests
- `apps/browser-extension/src/utils/aliasUtils.ts` — validation, random gen, hashing
- `apps/browser-extension/src/utils/__tests__/aliasUtils.test.ts` — 18 tests
- `apps/browser-extension/src/utils/emailKeyPair.ts` — X25519 keypair generation/storage
- `apps/browser-extension/src/utils/__tests__/emailKeyPair.test.ts` — 10 tests
- `apps/browser-extension/src/entrypoints/popup/pages/aliases/AliasGenerate.tsx` — Generate alias page
- `apps/browser-extension/src/entrypoints/popup/pages/aliases/__tests__/AliasGenerate.test.tsx` — 6 component tests
- `apps/browser-extension/src/config/bridge.ts` — Bridge relay commitment config

**Modified files:**
- `apps/browser-extension/src/services/MidnightContractService.ts` — added setEmailPublicKey, setMailRelay, readEmailPublicKey, readMailRelay
- `apps/browser-extension/src/entrypoints/popup/App.tsx` — added /aliases/generate route + AliasGenerate import
- `apps/browser-extension/src/entrypoints/popup/components/Icons/HeaderIcons.tsx` — added EMAIL icon type
- `apps/browser-extension/src/entrypoints/popup/pages/credentials/CredentialsList.tsx` — added "Generate Alias" header button
- `packages/blockchain/contract/src/index.ts` — added AliasRegistry + alias-registry-witnesses exports
- `shared/config/contracts.ts` — added AliasRegistry contract address entry
- `apps/browser-extension/package.json` — added tweetnacl dependency
- `pnpm-lock.yaml` — lockfile updated for tweetnacl
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status updated

## Change Log

- 2026-03-05: Story 5.2 implementation complete — Alias Generation UI with AliasService, email keypair generation, alias validation/random generation, AliasGenerate page component, route registration, bridge relay config, and 43 new tests.
- 2026-03-05: Code review fixes applied (C1, H1, H2, M1, M2, M3): C1 — claimStep resets to idle on input/random; H1 — removed duplicate hashAlias/ALIAS_DOMAIN from AliasService, imports from aliasUtils; H2 — added debounce timer cleanup useEffect; M1 — fixed misleading test title; M2 — added pnpm-lock.yaml to file list; M3 — added navigate to useEffect deps in CredentialsList.
