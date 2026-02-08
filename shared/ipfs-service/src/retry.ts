import { IpfsError, RETRYABLE_CODES } from './errors.js';

/**
 * Check if an error is retryable based on its code.
 * IpfsError instances check against RETRYABLE_CODES.
 * Generic errors (network timeouts, 5xx) are retryable by default.
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof IpfsError) {
    return RETRYABLE_CODES.includes(error.code);
  }
  // Network errors and timeouts are retryable
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }
  return false;
}

/**
 * Execute an async function with exponential backoff retry logic.
 * Only retries on transient failures (network, 5xx, timeouts).
 * Permanent failures (401 auth, invalid CID) throw immediately.
 *
 * @param fn - Async function to execute
 * @param maxRetries - Maximum retry attempts (default: 3)
 * @param baseDelayMs - Base delay in ms, doubled each retry (default: 1000)
 * @returns Result of fn()
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const retryable = isRetryableError(error);
      if (!retryable || attempt === maxRetries) {
        throw error;
      }
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  // TypeScript satisfaction — loop always returns or throws
  throw new Error('Unreachable');
}
