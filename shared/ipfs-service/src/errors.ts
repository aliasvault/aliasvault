/**
 * IPFS-specific error codes per architecture Pattern 4.
 */
export const IpfsErrorCodes = {
  IPFS_UPLOAD_FAILED: 'IPFS_UPLOAD_FAILED',
  IPFS_DOWNLOAD_FAILED: 'IPFS_DOWNLOAD_FAILED',
  IPFS_PIN_FAILED: 'IPFS_PIN_FAILED',
  IPFS_INVALID_CID: 'IPFS_INVALID_CID',
  IPFS_AUTH_FAILED: 'IPFS_AUTH_FAILED',
  IPFS_TIMEOUT: 'IPFS_TIMEOUT',
} as const;

export type IpfsErrorCode = typeof IpfsErrorCodes[keyof typeof IpfsErrorCodes];

/**
 * Codes that are safe to retry with exponential backoff.
 * Auth and invalid CID errors are permanent — never retry.
 */
export const RETRYABLE_CODES: readonly string[] = [
  IpfsErrorCodes.IPFS_UPLOAD_FAILED,
  IpfsErrorCodes.IPFS_DOWNLOAD_FAILED,
  IpfsErrorCodes.IPFS_PIN_FAILED,
  IpfsErrorCodes.IPFS_TIMEOUT,
];

/**
 * Structured IPFS error with retry metadata.
 */
export class IpfsError extends Error {
  public readonly code: IpfsErrorCode;
  public readonly technical?: string;
  public readonly retryable: boolean;

  constructor(code: IpfsErrorCode, message: string, technical?: string) {
    super(message);
    this.name = 'IpfsError';
    this.code = code;
    this.technical = technical;
    this.retryable = RETRYABLE_CODES.includes(code);
  }
}
