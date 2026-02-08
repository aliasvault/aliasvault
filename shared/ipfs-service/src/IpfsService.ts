import { assertCIDv1 } from '@aliasvault/contract';
import type { IpfsProvider, IpfsServiceConfig } from './types.js';
import { IpfsError, IpfsErrorCodes } from './errors.js';
import { withRetry } from './retry.js';

/** Default configuration values */
const DEFAULTS = {
  maxRetries: 3,
  baseDelayMs: 1000,
} as const;

/**
 * Wrap canonical assertCIDv1 to throw IpfsError instead of plain Error.
 */
function validateCIDv1(cid: string): void {
  try {
    assertCIDv1(cid);
  } catch (error) {
    throw new IpfsError(
      IpfsErrorCodes.IPFS_INVALID_CID,
      error instanceof Error ? error.message : 'Invalid CID format',
    );
  }
}

/**
 * Main IPFS service — depends on IpfsProvider interface (not Pinata directly).
 * Handles CIDv1 validation, retry logic, and error wrapping.
 */
export class IpfsService {
  private readonly provider: IpfsProvider;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;

  constructor(provider: IpfsProvider, config?: IpfsServiceConfig) {
    if (!provider) {
      throw new Error('IpfsProvider is required');
    }
    this.provider = provider;
    this.maxRetries = config?.maxRetries ?? DEFAULTS.maxRetries;
    this.baseDelayMs = config?.baseDelayMs ?? DEFAULTS.baseDelayMs;
  }

  /**
   * Upload raw bytes to IPFS. Returns CIDv1 string.
   * Validates returned CID is CIDv1 format.
   */
  async upload(data: Uint8Array): Promise<string> {
    if (!data || data.length === 0) {
      throw new IpfsError(
        IpfsErrorCodes.IPFS_UPLOAD_FAILED,
        'Upload data must not be empty',
      );
    }

    const cid = await withRetry(
      () => this.provider.upload(data),
      this.maxRetries,
      this.baseDelayMs,
    );

    validateCIDv1(cid);
    return cid;
  }

  /**
   * Download blob from IPFS by CID. Returns raw bytes.
   * Validates input CID is CIDv1 format before fetching.
   */
  async download(cid: string): Promise<Uint8Array> {
    validateCIDv1(cid);

    return await withRetry(
      () => this.provider.download(cid),
      this.maxRetries,
      this.baseDelayMs,
    );
  }
}
