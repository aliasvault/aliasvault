import { normalizeTotpAlgorithm, normalizeTotpDigits, normalizeTotpPeriod, ItemTypes } from '@aliasvault/models/vault';

import { buildOtpAuthUri } from '../../../../items/OtpAuthUri';
import { isBlank } from '../../../shared/StringUtils';
import { ImportException, ImportStage } from '../../models/ImportException';
import { UnsupportedOtpCodeError } from '../../models/UnsupportedOtpCodeError';
import { convertArchiveItems } from '../../readers/ArchiveImport';
import { getProperty, parseJson, readArray, readNumber, readObject, readString, readStringAtPath, requireObject, type JsonObject } from '../../readers/JsonReader';
import { sanitizeTotpSecretKey } from '../../writers/TotpHelper';

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
 * @throws {UnsupportedOtpCodeError} When the entry holds a code AliasVault cannot generate.
 */
function convertEntry(entry: JsonObject): ImportedCredential {
  const type = (readString(entry, 'type') ?? '').toUpperCase();
  if (type !== 'TOTP') {
    throw new UnsupportedOtpCodeError(`${type || 'Unknown'} codes are not supported, only TOTP.`);
  }

  const info = readObject(entry, 'info');
  if (!info) {
    throw new UnsupportedOtpCodeError('The entry holds no code.');
  }

  const issuer = readString(entry, 'issuer')?.trim() ?? '';
  const account = readString(entry, 'name')?.trim() ?? '';
  const note = readString(entry, 'note');
  return {
    ServiceName: issuer || account,
    Username: account || null,
    Notes: isBlank(note) ? null : note,
    TwoFactorSecret: buildTotpUri(info),
    ItemType: ItemTypes.Login,
  };
}

/**
 * The otpauth:// URI of a TOTP code, which carries its parameters into the import.
 * @param info - The entry's "info" object
 * @returns The URI
 * @throws {UnsupportedOtpCodeError} When the algorithm, digits or period cannot be generated.
 */
function buildTotpUri(info: JsonObject): string {
  const algorithm = (readString(info, 'algo') ?? 'SHA1').toUpperCase();
  const digits = readNumber(info, 'digits') ?? 6;
  const period = readNumber(info, 'period') ?? 30;
  // The normalizers fall back to the defaults for anything else, which would silently give wrong codes.
  if (normalizeTotpAlgorithm(algorithm) !== algorithm || normalizeTotpDigits(digits) !== digits || normalizeTotpPeriod(period) !== period) {
    throw new UnsupportedOtpCodeError(`TOTP codes with ${algorithm}, ${digits} digits and a ${period} second period are not supported.`);
  }

  const uri = buildOtpAuthUri('', readString(info, 'secret') ?? '', '', { Algorithm: algorithm, Digits: digits, Period: period });
  sanitizeTotpSecretKey(uri);
  return uri;
}
