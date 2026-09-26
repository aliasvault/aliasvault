import { ZipArchive } from '../../../shared/ZipArchive';
import { ImportException, ImportStage } from '../../models/ImportException';
import { JsonException, parseJson } from '../../readers/JsonReader';

import type { ImportedCredential } from '../../models/ImportedCredential';
import type { ImportFailure } from '../../models/ImportFailure';
import type { ImportFileResult } from '../../models/ImportFileResult';

/**
 * Open an uploaded ZIP archive.
 * @param bytes - The archive bytes
 * @returns The archive
 * @throws {ImportException} when the bytes are not a valid ZIP archive.
 */
export function openArchive(bytes: Uint8Array): ZipArchive {
  try {
    return ZipArchive.open(bytes);
  } catch (error) {
    throw new ImportException(ImportStage.Archive, `File is not a valid ZIP archive or is corrupted: ${errorMessage(error)}`, error);
  }
}

/**
 * Read and parse a JSON file from the ZIP archive.
 * @param archive - The ZIP archive
 * @param path - The path of the JSON file
 * @returns The parsed JSON value, never null
 * @throws {ImportException} when the file is missing, empty or not valid JSON.
 */
export function readArchiveJson(archive: ZipArchive, path: string): unknown {
  const text = archive.readText(path);
  if (text === null) {
    throw new ImportException(ImportStage.Parse, `'${path}' was not found in the archive`);
  }

  let result: unknown;
  try {
    result = parseJson(text);
  } catch (error) {
    throw new ImportException(ImportStage.Parse, `Failed to parse '${path}': ${errorMessage(error)}`, error);
  }

  if (result === null) {
    throw new ImportException(ImportStage.Parse, `'${path}' is empty or deserialized to null`);
  }
  return result;
}

/**
 * Convert raw items one by one, so a malformed item is reported as a failure instead of exiting the import.
 * @param entries - The raw items, in export order
 * @param convert - Converts one item; null skips it
 * @param titleOf - Best-effort title of an item, read straight from the entry
 * @returns The credentials and the per-item failures
 */
export function convertArchiveItems<T>(entries: T[], convert: (entry: T) => ImportedCredential | null, titleOf: (entry: T) => string | null): ImportFileResult {
  const result: ImportFileResult = { Credentials: [], FailedItems: [] };
  entries.forEach((entry, index) => {
    try {
      const credential = convert(entry);
      if (credential) {
        result.Credentials.push(credential);
      }
    } catch (error) {
      result.FailedItems.push(buildItemFailure(index, titleOf(entry), error));
    }
  });
  return result;
}

/**
 * Build the failure entry of an item. Only JSON errors carry their message; any other error could hold item content,
 * so it is reported by type only.
 * @param index - Zero-based position of the item within the file
 * @param title - Best-effort title of the item
 * @param error - The error thrown while processing the item
 * @returns A failure entry safe to surface in logs and the UI
 */
export function buildItemFailure(index: number, title: string | null, error: unknown): ImportFailure {
  if (error instanceof JsonException) {
    return { Index: index, ItemTitle: title, ExceptionType: 'JsonException', Message: `Failed to parse item: ${error.message}` };
  }

  const exceptionType = error instanceof Error ? error.name : 'Error';
  return { Index: index, ItemTitle: title, ExceptionType: exceptionType, Message: `Item could not be processed (${exceptionType}): see item #${index} in the export.` };
}

/**
 * The message of an unknown error.
 * @param error - The error
 * @returns The message
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
