/**
 * Browser-compatible Pinata IPFS provider using fetch() directly.
 * The shared @aliasvault/ipfs-service uses the Pinata SDK (Node.js-oriented).
 * This provider uses the Pinata REST API for browser extension compatibility.
 *
 * Follows the same interface pattern as shared/ipfs-service IpfsProvider.
 */

const PINATA_UPLOAD_URL = 'https://uploads.pinata.cloud/v3/files';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;

/**
 * CIDv1 validation (Rule 2: CIDv1 enforcement).
 * CIDv1 strings start with 'bafy' (dag-pb) or 'bafk' (raw) in base32.
 * Mirrors the canonical assertCIDv1 from @aliasvault/contract.
 */
function assertCIDv1(cid: string): void {
  if (!cid || typeof cid !== 'string') {
    throw new Error('CID must be a non-empty string');
  }
  if (!cid.startsWith('bafy') && !cid.startsWith('bafk')) {
    throw new Error(`Expected CIDv1 (base32, starts with bafy/bafk), got: ${cid.substring(0, 20)}...`);
  }
}

/**
 * Determine if an error is transient and worth retrying.
 * Network errors, timeouts, and 5xx server errors are retryable.
 */
function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  if (message.includes('network') || message.includes('timeout') || message.includes('fetch')) {
    return true;
  }
  // HTTP 5xx errors from Pinata are retryable
  const statusMatch = error.message.match(/\((\d{3})\)/);
  if (statusMatch) {
    const status = parseInt(statusMatch[1], 10);
    return status >= 500;
  }
  return false;
}

/**
 * Configuration for the browser Pinata provider.
 */
export interface PinataBrowserConfig {
  /** Pinata JWT token for authentication. */
  pinataJwt: string;
  /** Pinata gateway domain (e.g., "your-gateway.mypinata.cloud"). */
  pinataGateway: string;
  /** Maximum number of retries for transient failures. Default: 3. */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff. Default: 1000. */
  baseDelayMs?: number;
}

/**
 * Browser-compatible IPFS provider using Pinata REST API via fetch().
 */
export class PinataBrowserProvider {
  private readonly jwt: string;
  private readonly gateway: string;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;

  constructor(config: PinataBrowserConfig) {
    if (!config.pinataJwt) {
      throw new Error('Pinata JWT token is required');
    }
    if (!config.pinataGateway) {
      throw new Error('Pinata gateway domain is required');
    }
    this.jwt = config.pinataJwt;
    this.gateway = config.pinataGateway;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelayMs = config.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  }

  /**
   * Upload raw bytes to IPFS via Pinata Files API v3.
   * Returns CIDv1 string. Validates CIDv1 format before returning.
   * Retries transient failures with exponential backoff.
   */
  async upload(data: Uint8Array, filename?: string): Promise<string> {
    const cid = await this.withRetry(() => this.uploadOnce(data, filename));

    // Rule 2: CIDv1 enforcement — validate before any downstream use
    assertCIDv1(cid);

    return cid;
  }

  /**
   * Single upload attempt to Pinata.
   */
  private async uploadOnce(data: Uint8Array, filename?: string): Promise<string> {
    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
    const formData = new FormData();
    formData.append('file', blob, filename ?? 'vault.enc');

    const response = await fetch(PINATA_UPLOAD_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.jwt}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Pinata upload failed (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    // Pinata Files API v3 returns { data: { id, cid, ... } }
    const cid = result?.data?.cid;
    if (!cid || typeof cid !== 'string') {
      throw new Error('Pinata response missing CID');
    }

    return cid;
  }

  /**
   * Retry wrapper with exponential backoff for transient failures.
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.maxRetries && isRetryableError(lastError)) {
          const delay = this.baseDelayMs * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else if (!isRetryableError(lastError)) {
          throw lastError;
        }
      }
    }
    throw lastError;
  }

  /**
   * Download blob from IPFS via Pinata gateway.
   * Returns raw bytes. Retries transient failures with exponential backoff.
   */
  async download(cid: string): Promise<Uint8Array> {
    return this.withRetry(() => this.downloadOnce(cid));
  }

  /**
   * Single download attempt from Pinata gateway.
   */
  private async downloadOnce(cid: string): Promise<Uint8Array> {
    const url = `https://${this.gateway}/files/${cid}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Pinata download failed (${response.status})`);
    }

    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  /**
   * Discover the CID for a vault by scanning Pinata pin list and matching SHA-256 hashes.
   * Used on new devices where no local CID is cached.
   *
   * Flow: GET /v3/files → iterate pins → SHA-256(pin.cid) → compare with on-chain cidHash
   *
   * @param cidHash - On-chain vaultCidHash as Uint8Array (32 bytes)
   * @returns Matching CIDv1 string, or null if not found
   */
  async discoverCidByHash(cidHash: Uint8Array): Promise<string | null> {
    // M2: Wrap in withRetry() for transient Pinata API errors, consistent with upload/download.
    return this.withRetry(() => this.discoverCidByHashOnce(cidHash));
  }

  /**
   * Single discovery attempt — scans Pinata pin list pages for a CID matching the given hash.
   */
  private async discoverCidByHashOnce(cidHash: Uint8Array): Promise<string | null> {
    const targetHashHex = Array.from(cidHash)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    let pageToken: string | undefined;

    do {
      const url = new URL('https://api.pinata.cloud/v3/files');
      url.searchParams.set('status', 'pinned');
      url.searchParams.set('limit', '100');
      if (pageToken) {
        url.searchParams.set('pageToken', pageToken);
      }

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${this.jwt}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Pinata list files failed (${response.status})`);
      }

      const result = await response.json();
      const files = result?.data?.files ?? result?.data ?? [];

      for (const file of files) {
        const pinCid = file.cid;
        if (!pinCid || typeof pinCid !== 'string') continue;

        // SHA-256 hash the CID string and compare
        const encoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(pinCid));
        const hashHex = Array.from(new Uint8Array(hashBuffer))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');

        if (hashHex === targetHashHex) {
          // Rule 2: CIDv1 enforcement — validate before returning
          assertCIDv1(pinCid);
          return pinCid;
        }
      }

      // Pagination: check for next page token
      pageToken = result?.data?.next_page_token;
    } while (pageToken);

    return null;
  }
}
