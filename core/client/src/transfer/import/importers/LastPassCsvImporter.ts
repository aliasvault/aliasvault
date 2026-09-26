import { ItemTypes } from '@aliasvault/models/vault';

import { isBlank, nullIfBlank } from '../../shared/StringUtils';
import { readImportCsv } from '../readers/CsvImport';
import { optionalText, text } from '../readers/CsvRecordMapper';

import { parseUrls } from './shared/CredentialHelpers';

import type { ImportedCredential } from '../models/ImportedCredential';
import type { ImportedCreditcard } from '../models/ImportedCreditcard';

const COLUMNS = {
  url: optionalText,
  username: optionalText,
  password: optionalText,
  totp: optionalText,
  extra: optionalText,
  name: text,
  grouping: optionalText,
};

/** LastPass writes "http://sn" as the URL of a secure note and "http://" for an entry without one. */
const SECURE_NOTE_URL = 'http://sn';
const EMPTY_URL = 'http://';

/** Month names as LastPass writes them in the "Expiration Date" line of a credit card note ("May,2028"). */
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * Import a LastPass CSV export.
 * @param fileContent - The CSV file content
 * @returns The imported credentials
 */
export function importLastPassCsv(fileContent: string): ImportedCredential[] {
  return readImportCsv(fileContent, COLUMNS).filter(record => !isBlank(record.name)).map((record): ImportedCredential => {
    const credential: ImportedCredential = {
      ServiceName: record.name,
      ServiceUrls: record.url === EMPTY_URL || record.url === SECURE_NOTE_URL ? null : parseUrls(record.url),
      Username: record.username,
      Password: record.password,
      TwoFactorSecret: record.totp,
      Notes: record.extra,
      FolderPath: nullIfBlank(record.grouping),
    };

    if (record.extra?.includes('NoteType:Credit Card')) {
      credential.ItemType = ItemTypes.CreditCard;
      credential.Creditcard = parseCreditcard(record.extra);
      credential.Notes = extractCreditcardNotes(record.extra);
    } else if (record.url === SECURE_NOTE_URL && !record.username && !record.password) {
      credential.ItemType = ItemTypes.Note;
    }

    return credential;
  });
}

/**
 * Parse the card fields out of a credit card note's "Key:Value" lines.
 * @param notes - The credit card note
 * @returns The credit card
 */
function parseCreditcard(notes: string): ImportedCreditcard {
  const card: ImportedCreditcard = {};

  for (const line of notes.split(/[\r\n]+/)) {
    const colonIndex = line.indexOf(':');
    const key = line.substring(0, colonIndex).trim();
    const value = line.substring(colonIndex + 1).trim();
    if (colonIndex <= 0 || value.length === 0) {
      continue;
    }

    switch (key) {
      case 'Name on Card':
        card.CardholderName = value;
        break;
      case 'Number':
        card.Number = value;
        break;
      case 'Security Code':
        card.Cvv = value;
        break;
      case 'Expiration Date': {
        const parts = value.split(',');
        if (parts.length === 2) {
          const month = MONTHS.indexOf(parts[0].trim().toLowerCase()) + 1;
          card.ExpiryMonth = month > 0 ? String(month).padStart(2, '0') : null;
          card.ExpiryYear = parts[1].trim();
        }
        break;
      }
    }
  }

  return card;
}

/**
 * Extract the free-text part of a credit card note, everything from the "Notes:" line.
 * @param notes - The credit card note
 * @returns The notes, or null when there are none
 */
function extractCreditcardNotes(notes: string): string | null {
  const lines = notes.split(/[\r\n]+/).filter(line => line.length > 0);
  const start = lines.findIndex(line => line.startsWith('Notes:'));
  if (start < 0) {
    return null;
  }

  const noteLines = [lines[start].substring('Notes:'.length).trim(), ...lines.slice(start + 1)].filter((line, index) => index > 0 || line.length > 0);
  return noteLines.length > 0 ? noteLines.join('\n') : null;
}
