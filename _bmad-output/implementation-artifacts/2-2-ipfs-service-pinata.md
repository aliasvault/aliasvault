# Story 2.2: IPFS Service (Pinata)

Status: done

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
6. Provider abstraction: `IpfsProvider` interface enables swapping Pinata for any IPFS pinning service

## Tasks / Subtasks

- [x] Task 1: Create shared IPFS service package (AC: #1)
  - [x] 1.1: Create `shared/ipfs-service/` package scaffold (`package.json`, `tsconfig.json`, `src/index.ts`)
  - [x] 1.2: Install Pinata SDK: `pinata` (latest — NOT deprecated `@pinata/sdk` or `pinata-web3`)
  - [x] 1.3: Add `shared/ipfs-service` to `pnpm-workspace.yaml` packages list
  - [x] 1.4: Create `src/types.ts` — `IpfsProvider` interface, `IpfsUploadResult`, `IpfsServiceConfig`
  - [x] 1.5: Create `src/providers/PinataProvider.ts` — Pinata implementation of `IpfsProvider`
  - [x] 1.6: Create `src/IpfsService.ts` — main service class, depends on `IpfsProvider` (not Pinata directly)
  - [x] 1.7: Create `src/errors.ts` — IPFS-specific error types (per architecture Pattern 4)
- [x] Task 2: Implement upload functionality (AC: #2, #5)
  - [x] 2.1: Implement `upload(data: Uint8Array): Promise<string>` — uploads raw bytes, returns CIDv1 string
  - [x] 2.2: Convert `Uint8Array` to `File` object (Pinata SDK requires `File` or `Blob`)
  - [x] 2.3: Call `assertCIDv1()` on returned CID (import from `@aliasvault/contract`)
  - [x] 2.4: Return CID string (never CID object — architecture Pattern 3)
- [x] Task 3: Implement download functionality (AC: #3)
  - [x] 3.1: Implement `download(cid: string): Promise<Uint8Array>` — fetches blob by CID
  - [x] 3.2: Call `assertCIDv1()` on input CID before fetching
  - [x] 3.3: Use Pinata gateway for retrieval: `pinata.gateways.get(cid)` (SDK v1.10.1 — no `.public` namespace)
  - [x] 3.4: Convert response to `Uint8Array`
- [x] Task 4: Implement retry logic (AC: #4)
  - [x] 4.1: Create `src/retry.ts` — generic `withRetry<T>()` utility with exponential backoff
  - [x] 4.2: Retry on: network timeouts, 5xx responses, IPFS_UPLOAD_FAILED, IPFS_DOWNLOAD_FAILED
  - [x] 4.3: Default: 3 retries, base delay 1s, exponential factor 2x
  - [x] 4.4: Wrap both `upload()` and `download()` with retry logic
- [x] Task 5: Configuration and API key management (AC: #1)
  - [x] 5.1: `IpfsServiceConfig` interface: `pinataJwt`, `pinataGateway`, `maxRetries?`, `timeoutMs?`
  - [x] 5.2: Config injected via constructor (NO hardcoded keys — Rule 4 spirit)
  - [x] 5.3: Document `.env` variables: `PINATA_JWT`, `PINATA_GATEWAY`
- [x] Task 6: Unit tests (AC: #1-#5)
  - [x] 6.1: Create `src/__tests__/IpfsService.test.ts`
  - [x] 6.2: Test: upload returns CIDv1 string (mock Pinata SDK)
  - [x] 6.3: Test: upload rejects CIDv0 (mock returns Qm... CID)
  - [x] 6.4: Test: download returns Uint8Array for valid CID
  - [x] 6.5: Test: download rejects invalid CID format
  - [x] 6.6: Test: retry logic retries on transient failures
  - [x] 6.7: Test: retry logic does NOT retry on permanent failures (e.g., 401 auth)
  - [x] 6.8: Test: constructor validates required config fields
  - [x] 6.9: Create `src/__tests__/retry.test.ts` — unit tests for `withRetry`
- [x] Task 7: Build verification
  - [x] 7.1: `pnpm install` from monorepo root succeeds
  - [x] 7.2: `pnpm build` in `shared/ipfs-service/` succeeds
  - [x] 7.3: All tests pass
  - [x] 7.4: Package exports verified: `IpfsService`, `IpfsProvider`, `PinataProvider`, `IpfsServiceConfig`, `IpfsUploadResult`, `withRetry`

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

// Upload (SDK v1.10.1 — no .public namespace)
const fileObject = {
  name: "vault.bin",
  size: data.byteLength,
  type: "application/octet-stream",
  lastModified: Date.now(),
  arrayBuffer: () => Promise.resolve(data.buffer),
};
const upload = await pinata.upload.file(fileObject);
// Returns: { id, cid, name, size, ... } — cid is CIDv1 (bafk...)

// Download (SDK v1.10.1 — no .public namespace)
const response = await pinata.gateways.get(cid);
// Returns: { data: Blob | string | JSON | null, contentType }
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
│   │   ├── index.ts              # Re-exports
│   │   ├── IpfsService.ts        # Main service (depends on IpfsProvider interface)
│   │   ├── types.ts               # IpfsProvider interface, IpfsServiceConfig, IpfsUploadResult
│   │   ├── errors.ts              # Error types (Pattern 4)
│   │   ├── retry.ts               # withRetry utility
│   │   ├── providers/
│   │   │   └── PinataProvider.ts   # Pinata implementation of IpfsProvider
│   │   └── __tests__/
│   │       ├── IpfsService.test.ts
│   │       └── retry.test.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── build.sh
```

### Provider Abstraction — Vendor Portability (AC #6)

IPFS CIDs are content-addressed and provider-agnostic. To ensure we can swap Pinata for any IPFS pinning service (web3.storage, Filebase, self-hosted node) without changing consumers:

```typescript
// shared/ipfs-service/src/types.ts
export interface IpfsProvider {
  upload(data: Uint8Array, filename?: string): Promise<string>;  // returns CID
  download(cid: string): Promise<Uint8Array>;
}

// shared/ipfs-service/src/providers/PinataProvider.ts
import { PinataSDK } from 'pinata';
import type { IpfsProvider } from '../types';

export class PinataProvider implements IpfsProvider {
  private pinata: PinataSDK;
  constructor(jwt: string, gateway: string) {
    this.pinata = new PinataSDK({ pinataJwt: jwt, pinataGateway: gateway });
  }
  async upload(data: Uint8Array, filename?: string): Promise<string> { /* ... */ }
  async download(cid: string): Promise<Uint8Array> { /* ... */ }
}

// shared/ipfs-service/src/IpfsService.ts
export class IpfsService {
  constructor(private provider: IpfsProvider, private config: IpfsServiceConfig) {}
  async upload(data: Uint8Array): Promise<string> {
    const cid = await withRetry(() => this.provider.upload(data), this.config.maxRetries);
    assertCIDv1(cid);
    return cid;
  }
  async download(cid: string): Promise<Uint8Array> {
    assertCIDv1(cid);
    return await withRetry(() => this.provider.download(cid), this.config.maxRetries);
  }
}
```

**Key rules:**
- `IpfsService` depends ONLY on `IpfsProvider` interface — never imports `PinataSDK` directly
- CIDv1 validation, retry logic, and error wrapping live in `IpfsService` (not in providers)
- Providers are thin wrappers around SDK calls
- Consumers create the service: `new IpfsService(new PinataProvider(jwt, gw), config)`

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

### Uint8Array ↔ FileObject Conversion

Pinata SDK v1.10.1 uses a custom `FileObject` type (not Web `File`). For upload:

```typescript
const buffer: ArrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
const fileObject = {
  name: `vault-${Date.now()}.bin`,
  size: data.length,
  type: 'application/octet-stream',
  lastModified: Date.now(),
  arrayBuffer: (): Promise<ArrayBuffer> => Promise.resolve(buffer),
};
const result = await pinata.upload.file(fileObject);
```

For download, convert the gateway response back to `Uint8Array`:

```typescript
const response = await pinata.gateways.get(cid);
// response.data is Blob | string | JSON | null
// Handle: Blob → arrayBuffer → Uint8Array, string → TextEncoder, else throw
```

**VERIFIED:** `pinata.gateways.get(cid)` returns `GetCIDResponse` with `{ data, contentType }`. Binary uploads come back as `Blob`. PinataProvider handles all response types with explicit conversion.

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

Claude Sonnet 4 (Cascade)

### Debug Log References

- Pinata SDK v1.10.1 API differs from story dev notes: `pinata.upload.file()` not `pinata.upload.public.file()`, `pinata.gateways.get()` not `pinata.gateways.public.get()`. FileObject is custom type, not Web File API.
- TypeScript ArrayBuffer/SharedArrayBuffer incompatibility required explicit cast for Pinata FileObject.arrayBuffer()
- Added `shared/*` to pnpm-workspace.yaml — existing shared packages were NOT in workspace; now they are.

### Completion Notes List

- ✅ Created `@aliasvault/ipfs-service` package at `shared/ipfs-service/` with full provider abstraction
- ✅ `IpfsProvider` interface enables swapping Pinata for any IPFS pinning service (AC #6)
- ✅ `IpfsService` depends only on `IpfsProvider` — never imports PinataSDK directly
- ✅ Upload: `Uint8Array` → CIDv1 string with `assertCIDv1()` validation from `@aliasvault/contract` (AC #2, #5)
- ✅ Download: CID → `Uint8Array` with CIDv1 validation before fetch (AC #3)
- ✅ Retry logic: `withRetry<T>()` with exponential backoff (3 retries, 1s base, 2x factor) — only retries transient errors (AC #4)
- ✅ `IpfsError` class with error codes per architecture Pattern 4 — `RETRYABLE_CODES` distinguishes transient vs permanent
- ✅ Config injected via constructor, no hardcoded keys (Rule 4)
- ✅ 27 unit tests passing (13 IpfsService + 14 retry), 16 contract regression tests passing
- ✅ Build: tsup produces CJS + ESM + DTS
- **Deviation**: Pinata SDK v1.10.1 uses `upload.file()` / `gateways.get()` (no `.public` namespace). Story dev notes referenced older API pattern. PinataProvider uses custom FileObject type instead of Web File API.
- **Deviation**: `IpfsServiceConfig` split from `PinataProviderConfig` — service config has `maxRetries`, `baseDelayMs`, `timeoutMs`; provider config has `pinataJwt`, `pinataGateway`. This is cleaner separation per AC #6.

### File List

- NEW: `shared/ipfs-service/package.json` — Package definition, deps: pinata, @aliasvault/contract
- NEW: `shared/ipfs-service/tsconfig.json` — TypeScript config matching existing shared packages
- NEW: `shared/ipfs-service/tsup.config.ts` — Build config: CJS+ESM+DTS, externals
- NEW: `shared/ipfs-service/build.sh` — Build & distribute script
- NEW: `shared/ipfs-service/src/index.ts` — Re-exports all public API
- NEW: `shared/ipfs-service/src/types.ts` — IpfsProvider, IpfsUploadResult, IpfsServiceConfig, PinataProviderConfig
- NEW: `shared/ipfs-service/src/errors.ts` — IpfsError class, IpfsErrorCodes, RETRYABLE_CODES
- NEW: `shared/ipfs-service/src/retry.ts` — withRetry<T>(), isRetryableError()
- NEW: `shared/ipfs-service/src/IpfsService.ts` — Main service class with CIDv1 validation + retry
- NEW: `shared/ipfs-service/src/providers/PinataProvider.ts` — Pinata SDK implementation of IpfsProvider
- NEW: `shared/ipfs-service/src/__tests__/IpfsService.test.ts` — 13 tests (upload, download, CID validation, retry, config)
- NEW: `shared/ipfs-service/src/__tests__/retry.test.ts` — 14 tests (retryable errors, backoff, permanent failures)
- MODIFIED: `pnpm-workspace.yaml` — Added `shared/*` to packages list
- MODIFIED: `pnpm-lock.yaml` — Updated lockfile from workspace changes
- NEW: `shared/ipfs-service/eslint.config.mjs` — ESLint flat config adapted from identity-generator
- NEW: `shared/ipfs-service/README.md` — Package docs with setup, usage, error codes
- NEW: `shared/ipfs-service/.env.example` — Pinata credential placeholders
- MODIFIED: `shared/identity-generator/build.sh` — npm → pnpm
- MODIFIED: `shared/models/build.sh` — npm → pnpm
- MODIFIED: `shared/password-generator/build.sh` — npm → pnpm
- MODIFIED: `shared/vault-sql/build.sh` — npm → pnpm
- MODIFIED: `shared/build-and-distribute.sh` — Added ipfs-service to build orchestrator

### Review Follow-ups (AI)

- [x] [AI-Review][HIGH] H1: `timeoutMs` removed from `IpfsServiceConfig` and `DEFAULTS` — field was accepted but never implemented
- [x] [AI-Review][HIGH] H2: `IpfsUploadResult` removed from types.ts and index.ts — dead code, `upload()` returns `string`
- [x] [AI-Review][HIGH] H3: `build.sh` npm → pnpm — fixed across ALL 5 shared packages
- [x] [AI-Review][HIGH] H4: Created `README.md` with setup/usage/error docs and `.env.example` with placeholder values
- [x] [AI-Review][HIGH] H5: Created `eslint.config.mjs` — lint passes clean on all source files
- [x] [AI-Review][MEDIUM] M1: PinataProvider constructor now throws plain `Error` for missing config (not `IpfsError`) — config errors are programmer mistakes
- [N/A] [AI-Review][MEDIUM] M2: `_bmad-output/architecture.md` was NOT modified by dev agent — reviewer false positive
- [x] [AI-Review][MEDIUM] M3: `pnpm-lock.yaml` added to File List
- [x] [AI-Review][LOW] L1: Removed JSON.stringify fallback — now throws `IpfsError(IPFS_DOWNLOAD_FAILED)` on unexpected response types
- [x] [AI-Review][LOW] L2: Updated dev notes with correct Pinata SDK v1.10.1 API (FileObject, no .public namespace)

### Change Log

- 2026-02-07: Story 2.2 implementation complete — IPFS service with Pinata provider, retry logic, 27 tests passing
- 2026-02-07: Code review — 5 HIGH, 3 MEDIUM, 2 LOW issues found. All ACs implemented. 27/27 tests passing. Status → in-progress pending follow-up fixes.
- 2026-02-07: Review fixes applied — 9/10 items fixed (M2 invalid). Also fixed npm→pnpm in all 5 shared build.sh files. 27/27 tests, build, lint all pass.
- 2026-02-07: Re-review passed — 1 LOW (missing lint in build.sh) fixed. All checks green. Status → done.
