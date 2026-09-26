/**
 * A single item that failed to be parsed during an import, kept alongside the successfully imported items
 * so the user can see which entries were skipped.
 */
export type ImportFailure = {
  /** Zero-based index of the item within the source file. */
  Index: number;
  /** Title of the failing item, if it could be read. */
  ItemTitle?: string | null;
  /** The error type name (e.g. "JsonException"). */
  ExceptionType: string;
  /** The error message describing what went wrong. */
  Message: string;
};
