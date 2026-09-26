import type { ImportedCredential } from './ImportedCredential';
import type { ImportFailure } from './ImportFailure';

/**
 * Result of an import file processor: the credentials that were parsed plus the per-item failures that were skipped.
 */
export type ImportFileResult = {
  Credentials: ImportedCredential[];
  FailedItems: ImportFailure[];
};
