import { ImportException, ImportStage } from '../../models/ImportException';
import { convertArchiveItems } from '../../readers/ArchiveImport';
import { getProperty, parseJson, readArray, readNumber, readObject, readString, readStringAtPath, requireObject, type JsonObject } from '../../readers/JsonReader';
import { convertTwoFactorEntry } from '../../readers/TwoFactorImport';

import type { ImportedCredential } from '../../models/ImportedCredential';
import type { ImportFileResult } from '../../models/ImportFileResult';

/*
 * Note: every code becomes its own login item in the root on purpose, which the user then merges into the matching login.
 * Any group information stored in Aegis is ignored during import.
 */

/**
 * Import an unencrypted Aegis Authenticator .json export.
 * @param fileContent - The JSON file content
 * @returns The credentials and the entries that could not be imported
 * @throws {ImportException} When the file is not an Aegis export or the export is encrypted.
 */
export function importAegisJson(fileContent: string): ImportFileResult {
  let entries: unknown[];
  try {
    entries = readEntries(requireObject(parseJson(fileContent), 'The Aegis export'));
  } catch (error) {
    if (error instanceof ImportException) {
      throw error;
    }
    throw new ImportException(ImportStage.Parse, `Failed to parse the Aegis export: ${error instanceof Error ? error.message : String(error)}`, error);
  }
  return convertArchiveItems(entries, entry => convertEntry(requireObject(entry, 'Entry')), entry => readStringAtPath(entry, 'issuer') || readStringAtPath(entry, 'name'));
}

/**
 * The raw entries of an export.
 * @param root - The root object
 * @returns The entries
 * @throws {ImportException} When the export is encrypted or holds no entries.
 */
function readEntries(root: JsonObject): unknown[] {
  // An encrypted export has key slots in its header and the entries as one encrypted string in "db".
  const header = readObject(root, 'header');
  const slots = header ? getProperty(header, 'slots') : null;
  if ((Array.isArray(slots) && slots.length > 0) || typeof getProperty(root, 'db') === 'string') {
    throw new ImportException(ImportStage.Parse, 'Encrypted Aegis exports are not supported. Please export without encryption.');
  }

  const db = readObject(root, 'db');
  const entries = db ? readArray(db, 'entries') : null;
  if (!entries) {
    throw new ImportException(ImportStage.Parse, 'Failed to parse the Aegis export: no entries found.');
  }
  return entries;
}

/**
 * Convert an entry to a login holding its code.
 * @param entry - The entry
 * @returns The credential
 */
function convertEntry(entry: JsonObject): ImportedCredential {
  const info = readObject(entry, 'info') ?? {};
  return convertTwoFactorEntry({
    name: readString(entry, 'issuer'),
    account: readString(entry, 'name'),
    note: readString(entry, 'note'),
    type: readString(entry, 'type'),
    secret: readString(info, 'secret'),
    algorithm: readString(info, 'algo'),
    digits: readNumber(info, 'digits'),
    period: readNumber(info, 'period'),
  });
}
