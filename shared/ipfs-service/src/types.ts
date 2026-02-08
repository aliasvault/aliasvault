/**
 * IPFS provider interface — enables swapping Pinata for any IPFS pinning service.
 * Implementations are thin wrappers around SDK calls; validation/retry live in IpfsService.
 */
export interface IpfsProvider {
  /** Upload raw bytes, returns CID string. */
  upload(data: Uint8Array, filename?: string): Promise<string>;
  /** Download blob by CID, returns raw bytes. */
  download(cid: string): Promise<Uint8Array>;
}

/**
 * Configuration for IpfsService.
 * API keys injected via constructor — never hardcoded.
 */
export interface IpfsServiceConfig {
  /** Maximum number of retries for transient failures (default: 3) */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  baseDelayMs?: number;
}

/**
 * Configuration for PinataProvider.
 */
export interface PinataProviderConfig {
  /** Pinata JWT token for authentication */
  pinataJwt: string;
  /** Pinata gateway domain (e.g., "your-gateway.mypinata.cloud") */
  pinataGateway: string;
}
