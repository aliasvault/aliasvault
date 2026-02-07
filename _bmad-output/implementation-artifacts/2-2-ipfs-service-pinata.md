# Story 2.2: IPFS Service (Pinata)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want an IPFS service that uploads encrypted blobs to Pinata,
so that vault data is reliably stored and retrieval strings are generated.

## Acceptance Criteria

1. `IpfsService.ts` created with Pinata SDK
2. Feature: Upload `Uint8Array` → returns CIDv1 string
3. Feature: Download CID → returns `Uint8Array`
4. Error handling for network failures (retry logic with exponential backoff)
5. Validation: Returned CID must be CIDv1 (using existing `assertCIDv1`)

## Tasks / Subtasks

- [ ] Task 1: Create shared IPFS service package (AC: #1)
  - [ ] 1.1: Create `shared/ipfs-service/` package scaffold (`package.json`, `tsconfig.json`, `src/index.ts`)
  - [ ] 1.2: Install Pinata SDK: `pinata` (latest — NOT deprecated `@pinata/sdk` or `pinata-web3`)
  - [ ] 1.3: Add `shared/ipfs-service` to `pnpm-workspace.yaml` packages list
  - [ ] 1.4: Create `src/IpfsService.ts` — main service class
  - [ ] 1.5: Create `src/types.ts` — `IpfsUploadResult`, `IpfsServiceConfig` interfaces
  - [ ] 1.6: Create `src/errors.ts` — IPFS-specific error types (per architecture Pattern 4)
- [ ] Task 2: Implement upload functionality (AC: #2, #5)
  - [ ] 2.1: Implement `upload(data: Uint8Array): Promise<string>` — uploads raw bytes, returns CIDv1 string
  - [ ] 2.2: Convert `Uint8Array` to `File` object (Pinata SDK requires `File` or `Blob`)
  - [ ] 2.3: Call `assertCIDv1()` on returned CID (import from `@aliasvault/contract`)
  - [ ] 2.4: Return CID string (never CID object — architecture Pattern 3)
- [ ] Task 3: Implement download functionality (AC: #3)
  - [ ] 3.1: Implement `download(cid: string): Promise<Uint8Array>` — fetches blob by CID
  - [ ] 3.2: Call `assertCIDv1()` on input CID before fetching
  - [ ] 3.3: Use Pinata gateway for retrieval: `pinata.gateways.public.get(cid)`
  - [ ] 3.4: Convert response to `Uint8Array`
- [ ] Task 4: Implement retry logic (AC: #4)
  - [ ] 4.1: Create `src/retry.ts` — generic `withRetry<T>()` utility with exponential backoff
  - [ ] 4.2: Retry on: network timeouts, 5xx responses, IPFS_UPLOAD_FAILED, IPFS_DOWNLOAD_FAILED
  - [ ] 4.3: Default: 3 retries, base delay 1s, exponential factor 2x
  - [ ] 4.4: Wrap both `upload()` and `download()` with retry logic
- [ ] Task 5: Configuration and API key management (AC: #1)
  - [ ] 5.1: `IpfsServiceConfig` interface: `pinataJwt`, `pinataGateway`, `maxRetries?`, `timeoutMs?`
  - [ ] 5.2: Config injected via constructor (NO hardcoded keys — Rule 4 spirit)
  - [ ] 5.3: Document `.env` variables: `PINATA_JWT`, `PINATA_GATEWAY`
- [ ] Task 6: Unit tests (AC: #1-#5)
  - [ ] 6.1: Create `src/__tests__/IpfsService.test.ts`
  - [ ] 6.2: Test: upload returns CIDv1 string (mock Pinata SDK)
  - [ ] 6.3: Test: upload rejects CIDv0 (mock returns Qm... CID)
  - [ ] 6.4: Test: download returns Uint8Array for valid CID
  - [ ] 6.5: Test: download rejects invalid CID format
  - [ ] 6.6: Test: retry logic retries on transient failures
  - [ ] 6.7: Test: retry logic does NOT retry on permanent failures (e.g., 401 auth)
  - [ ] 6.8: Test: constructor validates required config fields
  - [ ] 6.9: Create `src/__tests__/retry.test.ts` — unit tests for `withRetry`
- [ ] Task 7: Build verification
  - [ ] 7.1: `pnpm install` from monorepo root succeeds
  - [ ] 7.2: `pnpm build` in `shared/ipfs-service/` succeeds
  - [ ] 7.3: All tests pass
  - [ ] 7.4: Package exports verified: `IpfsService`, `IpfsServiceConfig`, `IpfsUploadResult`, `withRetry`

## Dev Notes

### CRITICAL: Pinata SDK Version (2025+)

The architecture references `ipfs-http-client` and `@pinata/sdk` — **both are deprecated**. Use the new unified SDK:

```bash
npm install pinata
```

**SDK API** (from `pinata` package):
```typescript
import { PinataSDK } from "pinata";

const pinata = new PinataSDK({
  pinataJwt: "YOUR_JWT",
  pinataGateway: "your-gateway.mypinata.cloud",
});

// Upload
const file = new File([data], "vault.bin", { type: "application/octet-stream" });
const upload = await pinata.upload.public.file(file);
// Returns: { id, cid, name, size, ... } — cid is CIDv1 (bafk...)

// Download
const response = await pinata.gateways.public.get(cid);
// Returns response data
```

**DO NOT USE:**
- `@pinata/sdk` — deprecated, redirects to `pinata-web3`
- `pinata-web3` — deprecated, replaced by `pinata`
- `ipfs-http-client` — deprecated, not maintained

### Package Location: `shared/ipfs-service/`

Per `project-context.md` Rule 3 (ADR-003): ALL business logic MUST be in `shared/`. The IPFS service is reused by:
- Browser extension (Story 2.3/2.4 vault sync)
- Future SMTP bridge (Story 5.5 email encryption)
- Future mobile app

**Package name:** `@aliasvault/ipfs-service`

```
shared/
├── ipfs-service/
│   ├── src/
│   │   ├── index.ts          # Re-exports
│   │   ├── IpfsService.ts    # Main service class
│   │   ├── types.ts           # Interfaces
│   │   ├── errors.ts          # Error types (Pattern 4)
│   │   ├── retry.ts           # withRetry utility
│   │   └── __tests__/
│   │       ├── IpfsService.test.ts
│   │       └── retry.test.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── build.sh
```

### CIDv1 Validation — Reuse Existing

`assertCIDv1` already exists at `packages/blockchain/contract/src/cid-utils.ts` (canonical location from Story 2.1). Import from `@aliasvault/contract`:

```typescript
import { assertCIDv1 } from '@aliasvault/contract';
```

**DO NOT** duplicate `assertCIDv1` in the IPFS service package. If `@aliasvault/contract` dependency is too heavy, consider extracting `cid-utils.ts` to a lighter shared package in a future story. For now, the direct import is acceptable.

### Error Handling — Architecture Pattern 4

All errors MUST follow the `AppError` structure from architecture:

```typescript
// shared/ipfs-service/src/errors.ts
export interface IpfsError {
  code: string;
  message: string;
  technical?: string;
  retryable: boolean;
}

export const IpfsErrorCodes = {
  IPFS_UPLOAD_FAILED: 'IPFS_UPLOAD_FAILED',
  IPFS_DOWNLOAD_FAILED: 'IPFS_DOWNLOAD_FAILED',
  IPFS_PIN_FAILED: 'IPFS_PIN_FAILED',
  IPFS_INVALID_CID: 'IPFS_INVALID_CID',
  IPFS_AUTH_FAILED: 'IPFS_AUTH_FAILED',
  IPFS_TIMEOUT: 'IPFS_TIMEOUT',
} as const;

export const RETRYABLE_CODES: readonly string[] = [
  IpfsErrorCodes.IPFS_UPLOAD_FAILED,
  IpfsErrorCodes.IPFS_DOWNLOAD_FAILED,
  IpfsErrorCodes.IPFS_PIN_FAILED,
  IpfsErrorCodes.IPFS_TIMEOUT,
];
// NOT retryable: IPFS_AUTH_FAILED, IPFS_INVALID_CID
```

### Retry Logic — Architecture Pattern 4

```typescript
// shared/ipfs-service/src/retry.ts
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRetryable = isRetryableError(error);
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error('Unreachable'); // TypeScript satisfaction
}
```

### Uint8Array ↔ File Conversion

Pinata SDK works with `File` objects (Web API). For upload:

```typescript
const file = new File(
  [data],                          // Uint8Array → accepted by File constructor
  `vault-${Date.now()}.bin`,       // Filename (metadata only, not stored on IPFS)
  { type: 'application/octet-stream' }
);
const result = await pinata.upload.public.file(file);
```

For download, convert the gateway response back to `Uint8Array`:

```typescript
const response = await pinata.gateways.public.get(cid);
// Response handling depends on Pinata SDK response type
// May need: new Uint8Array(await response.arrayBuffer())
```

**IMPORTANT:** Verify the exact return type of `pinata.gateways.public.get()` at implementation time. The SDK may return `Blob`, `ArrayBuffer`, or a custom response object. Write a conversion helper.

### API Key Security

- **NEVER** hardcode `PINATA_JWT` in source code
- Config injected via constructor: `new IpfsService({ pinataJwt, pinataGateway })`
- In browser extension: store JWT in `chrome.storage.local` (encrypted via existing EncryptionUtility)
- In CLI/tests: use environment variables
- Document required env vars in package README

### CID Field Naming (Architecture Pattern 3)

- Field name: always `vaultCID` (not `cid`, `vault_cid`, `ipfsCID`)
- Storage: always `string` type (never CID object)
- Format: CIDv1 base32 (`bafybei...` or `bafkrei...`)
- The `upload()` method returns plain `string`, not a branded type (branding happens at call site)

### Existing Code to NOT Touch

- `packages/blockchain/contract/src/cid-utils.ts` — canonical `assertCIDv1`, unchanged
- `packages/blockchain/contract/src/vault-registry.compact` — contract, unchanged
- `packages/blockchain/cli/src/vault-registry-api.ts` — already has CIDv1 validation, unchanged
- `shared/config/contracts.ts` — updated in Story 2.5, not now

### Build Pattern (Follow Existing Shared Packages)

Look at `shared/identity-generator/` or `shared/password-generator/` for the build pattern:
- `build.sh` script for build step
- `tsconfig.json` extending root config
- `package.json` with proper `main`, `types`, `exports` fields

### Testing Approach

Mock the Pinata SDK entirely — do NOT make real API calls in unit tests:

```typescript
// Mock pattern
jest.mock('pinata', () => ({
  PinataSDK: jest.fn().mockImplementation(() => ({
    upload: {
      public: {
        file: jest.fn().mockResolvedValue({
          cid: 'bafkreid7qoywk77r7rj3slobqfekdvs57qwuwh5d2z3sqsw52iabe3mqne',
          id: 'test-id',
          size: 100,
        }),
      },
    },
    gateways: {
      public: {
        get: jest.fn().mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])])),
      },
    },
  })),
}));
```

### Previous Story Intelligence (Story 2.1)

**Key learnings from Story 2.1:**
- `assertCIDv1` is basic format check (regex-based) — acceptable for MVP
- Full CID is stored at app layer (TypeScript Map), not in Midnight private state
- On-chain stores only SHA-256 hash of CID as `Bytes<32>`
- Package naming convention: `@aliasvault/<name>` (e.g., `@aliasvault/contract`, `@aliasvault/cli`)
- Existing test infrastructure: Vitest used in contract package, Jest in browser extension

**From code review:**
- `assertCIDv1` in `cid-utils.ts` is the canonical location — do not duplicate
- CIDv1 validation is simplistic (L1 acknowledged) — sufficient for MVP

### SDK Versions (VERIFIED WORKING in Story 2.1)

- Node.js: >= 18 (per `package.json` engines)
- TypeScript: 5+
- pnpm: >= 8
- Package manager: pnpm workspaces

### Git Intelligence (Recent Commits)

```
6fdc36d0 refactor: rename counter-cli to cli in blockchain package
938272f9 docs(bmad): add Epic 1 story files and update epics
62aa4529 test: add unit tests for wallet utils and VaultRegistry contract
748401c7 refactor(blockchain): rename contract package to @aliasvault/contract
4ecc61a0 refactor(extension): wallet code cleanup from Epic 1 code review
```

**Patterns established:**
- `@aliasvault/` namespace for all packages
- Tests co-located in `src/__tests__/` or `src/test/`
- Commit convention: `type(scope): description`

### Project Structure Notes

- New package at `shared/ipfs-service/` follows existing `shared/` package pattern
- Must be added to `pnpm-workspace.yaml` (currently lists `packages/*` and `packages/blockchain/*`)
- The `shared/` directory is NOT currently in the workspace list — check if `shared/*` needs adding or if packages are managed differently
- Existing shared packages (`identity-generator`, `models`, `password-generator`) have their own `build.sh` scripts

### References

- [Source: _bmad-output/architecture.md#2-IPFS-Pinning-Strategy] — Pinata decision, multi-region config
- [Source: _bmad-output/architecture.md#Pattern-3-IPFS-CID-Handling] — CID standards, field naming, type handling
- [Source: _bmad-output/architecture.md#Pattern-4-Error-Handling-Standards] — AppError, ErrorCodes, RETRYABLE_CODES
- [Source: _bmad-output/project-context.md#Rule-2-CIDv1-Enforcement] — assertCIDv1 requirement
- [Source: _bmad-output/project-context.md#Rule-3-Shared-Business-Logic-Enforcement] — ADR-003, shared/logic/ location
- [Source: _bmad-output/project-context.md#Rule-5-Error-Handling-with-Retry-Logic] — withRetry pattern
- [Source: packages/blockchain/contract/src/cid-utils.ts] — Existing assertCIDv1 implementation
- [Source: shared/config/contracts.ts] — Contract address management pattern (ADR-004)
- [Source: https://github.com/PinataCloud/pinata] — Latest Pinata SDK (replaces @pinata/sdk and pinata-web3)

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

