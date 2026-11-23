import { parseOtpAuthUri } from '../../../../items/OtpAuthUri';
import { ImportException, ImportStage } from '../../models/ImportException';
import { convertArchiveItems } from '../../readers/ArchiveImport';
import { isJsonObject } from '../../readers/JsonReader';
import { convertTwoFactorEntry } from '../../readers/TwoFactorImport';

import type { ImportedCredential } from '../../models/ImportedCredential';
import type { ImportFileResult } from '../../models/ImportFileResult';

/*
 * A text file with one otpauth:// link per line: the "Plain text" export of Ente Auth, and the URI list FreeOTP+, Stratum
 * and Aegis can export. Ente writes the label unencoded when a code was edited, and adds a "codeDisplay" parameter
 * (JSON) with the note and whether the code is in its trash.
 */

/** An otpauth link: its type, label and query. */
const OTPAUTH_LINK = /^otpauth:\/\/([^/?]+)\/([^?]*)(?:\?(.*))?$/i;

/**
 * Import a text file of otpauth:// links.
 * @param fileContent - The file content
 * @returns The credentials and the lines that could not be imported
 * @throws {ImportException} When the file holds no otpauth:// links.
 */
export function importOtpAuthList(fileContent: string): ImportFileResult {
  const lines = fileContent.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  if (!lines.some(line => OTPAUTH_LINK.test(line))) {
    throw new ImportException(ImportStage.Parse, 'Failed to parse the file: no otpauth:// links found.');
  }
  return convertArchiveItems(lines, convertLink, titleOfLink);
}

/**
 * Convert a link to a login holding its code.
 * @param line - The link
 * @returns The credential, or null for a code in Ente's trash
 * @throws {Error} When the line is not an otpauth link.
 */
function convertLink(line: string): ImportedCredential | null {
  const match = OTPAUTH_LINK.exec(line);
  if (!match) {
    throw new Error('Not an otpauth:// link.');
  }
  const [, type, label, query = ''] = match;
  const params = new URLSearchParams(query);
  const display = readCodeDisplay(params.get('codeDisplay'));
  if (display.trashed) {
    return null;
  }

  // The TOTP parser reads the label, issuer and secret of every type; the parameters are read as-is to catch unsupported values.
  const parsed = parseOtpAuthUri(`otpauth://totp/${label}?${query}`);
  const labelIssuer = parsed && parsed.label !== parsed.account ? parsed.label.slice(0, parsed.label.indexOf(':')) : null;
  return convertTwoFactorEntry({
    name: parsed?.issuer || labelIssuer,
    account: parsed?.account ?? null,
    note: display.note,
    type,
    secret: parsed?.secret ?? null,
    algorithm: params.get('algorithm'),
    digits: readNumberParam(params, 'digits'),
    period: readNumberParam(params, 'period'),
  });
}

/**
 * The note and trash state Ente stores in the "codeDisplay" parameter.
 * @param value - The parameter value, or null
 * @returns The note and whether the code is in the trash
 */
function readCodeDisplay(value: string | null): { note: string | null; trashed: boolean } {
  try {
    const display: unknown = value ? JSON.parse(value) : null;
    if (isJsonObject(display)) {
      return { note: typeof display.note === 'string' ? display.note : null, trashed: display.trashed === true };
    }
  } catch {
    // An unreadable codeDisplay only loses the note.
  }
  return { note: null, trashed: false };
}

/**
 * A numeric query parameter.
 * @param params - The query
 * @param name - The parameter name
 * @returns The number (NaN when it is not one), or null when absent
 */
function readNumberParam(params: URLSearchParams, name: string): number | null {
  const value = params.get(name);
  return value === null || value.trim() === '' ? null : Number(value);
}

/**
 * Best-effort title of a line for the failure list: the issuer, else the label.
 * @param line - The line
 * @returns The title, or null
 */
function titleOfLink(line: string): string | null {
  const match = OTPAUTH_LINK.exec(line);
  if (!match) {
    return null;
  }
  const issuer = new URLSearchParams(match[3] ?? '').get('issuer');
  if (issuer) {
    return issuer;
  }
  try {
    return decodeURIComponent(match[2]);
  } catch {
    return match[2];
  }
}
