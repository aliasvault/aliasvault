/**
 * Identifies which stage of the import process produced an error.
 */
export enum ImportStage {
  /** The file could not be opened or read as an archive (corrupt zip, truncated download, etc.). */
  Archive = 'Archive',

  /** The archive could be opened but its contents could not be parsed (missing manifest, malformed JSON, unexpected schema). */
  Parse = 'Parse',

  /** The parsed credentials could not be saved into the local vault database. */
  Save = 'Save',
}

/**
 * Raised by importers when a catastrophic failure occurs. Carries the stage so the UI can present
 * an actionable, copyable error payload.
 */
export class ImportException extends Error {
  /** The pipeline stage where the failure happened. */
  public readonly stage: ImportStage;

  /** The error that triggered this failure, if any. */
  public readonly innerError: unknown;

  /**
   * Create the exception.
   * @param stage - The pipeline stage where the failure happened
   * @param message - A human-readable description of what went wrong
   * @param innerError - The error that triggered this failure
   */
  public constructor(stage: ImportStage, message: string, innerError?: unknown) {
    super(message);
    this.name = 'ImportException';
    this.stage = stage;
    this.innerError = innerError;
    Object.setPrototypeOf(this, ImportException.prototype);
  }
}
