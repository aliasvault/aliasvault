/**
 * Thrown when the vault cannot be loaded for a reason OTHER than the server being unreachable or outdated:
 * the encrypted snapshot was fetched successfully, but decrypting, unpacking, materializing, or reassembling
 * it into a local SQLite database failed. These are client-side (codec/format/integrity/corruption) failures.
 */
export class VaultProcessingError extends Error {
  /** Where in the flow the failure happened (for the copyable report, e.g. "vault-pull"). */
  public readonly source: string;

  /** The original error that caused this failure (kept for logging / inspection). */
  public readonly originalError: unknown;

  /** Technical detail for the copyable report only, not shown in the message. */
  public readonly detail?: string;

  /**
   * Creates a new instance of VaultProcessingError.
   * @param source - a short identifier of the flow that failed (included in the copyable report).
   * @param originalError - the underlying error whose message + stack are preserved.
   * @param detail - technical detail for the copyable report only.
   */
  public constructor(source: string, originalError: unknown, detail?: string) {
    const causeMessage = originalError instanceof Error ? originalError.message : String(originalError);
    super(causeMessage);
    this.name = 'VaultProcessingError';
    this.source = source;
    this.originalError = originalError;
    this.detail = detail;

    // Preserve the original stack so the copyable report points at the real failure site, not this wrapper.
    if (originalError instanceof Error && originalError.stack) {
      this.stack = originalError.stack;
    }

    Object.setPrototypeOf(this, VaultProcessingError.prototype);
  }
}
