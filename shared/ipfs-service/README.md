# @aliasvault/ipfs-service

Shared IPFS service for AliasVault. Uploads and downloads `Uint8Array` data via IPFS pinning providers (currently Pinata). Returns CIDv1 strings, enforces CIDv1 validation, and includes retry logic with exponential backoff.

## Architecture

```
IpfsService  ─depends on─►  IpfsProvider (interface)
                                  │
                            PinataProvider (implementation)
```

- **`IpfsService`** — main entry point. Handles CIDv1 validation (via `@aliasvault/contract`), retry logic, and error wrapping. Never imports a specific SDK.
- **`IpfsProvider`** — interface that enables swapping Pinata for any IPFS pinning service (web3.storage, Filebase, self-hosted node).
- **`PinataProvider`** — thin wrapper around the Pinata SDK.

## Setup

### Environment Variables

| Variable | Description | Example |
|---|---|---|
| `PINATA_JWT` | Pinata API JWT token | `eyJhbGci...` |
| `PINATA_GATEWAY` | Pinata dedicated gateway domain | `your-gateway.mypinata.cloud` |

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

**Never hardcode API keys in source code.**

## Usage

```typescript
import { IpfsService, PinataProvider } from '@aliasvault/ipfs-service';

const provider = new PinataProvider({
  pinataJwt: process.env.PINATA_JWT!,
  pinataGateway: process.env.PINATA_GATEWAY!,
});

const ipfs = new IpfsService(provider, {
  maxRetries: 3,    // default: 3
  baseDelayMs: 1000 // default: 1000ms, doubles each retry
});

// Upload
const cid = await ipfs.upload(new Uint8Array([1, 2, 3]));
// Returns CIDv1 string: "bafkrei..."

// Download
const data = await ipfs.download(cid);
// Returns Uint8Array
```

## Error Handling

All errors are `IpfsError` instances with structured codes:

| Code | Retryable | Description |
|---|---|---|
| `IPFS_UPLOAD_FAILED` | Yes | Upload to pinning service failed |
| `IPFS_DOWNLOAD_FAILED` | Yes | Download from gateway failed |
| `IPFS_PIN_FAILED` | Yes | Pinning operation failed |
| `IPFS_TIMEOUT` | Yes | Request timed out |
| `IPFS_AUTH_FAILED` | No | Authentication failed (bad JWT) |
| `IPFS_INVALID_CID` | No | CID is not valid CIDv1 format |

```typescript
import { IpfsError, IpfsErrorCodes } from '@aliasvault/ipfs-service';

try {
  await ipfs.upload(data);
} catch (err) {
  if (err instanceof IpfsError) {
    console.log(err.code);      // e.g. 'IPFS_UPLOAD_FAILED'
    console.log(err.retryable);  // true
    console.log(err.technical);  // raw error details
  }
}
```

## Scripts

```bash
pnpm build          # Build CJS + ESM + DTS via tsup
pnpm test           # Run tests via vitest
pnpm test:watch     # Watch mode
pnpm test:coverage  # Coverage report
pnpm lint           # ESLint
```

## License

AGPL-3.0
