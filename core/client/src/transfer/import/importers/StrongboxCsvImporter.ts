import { readImportCsv } from '../readers/CsvImport';
import { optionalText, text } from '../readers/CsvRecordMapper';

import { parseUrls } from './shared/CredentialHelpers';

import type { ImportedCredential } from '../models/ImportedCredential';

const COLUMNS = {
  Title: text,
  Username: optionalText,
  Password: optionalText,
  URL: optionalText,
  OTPAuth: optionalText,
  Notes: optionalText,
};

/**
 * Import a Strongbox CSV export.
 * @param fileContent - The CSV file content
 * @returns The imported credentials
 */
export function importStrongboxCsv(fileContent: string): ImportedCredential[] {
  return readImportCsv(fileContent, COLUMNS).map(record => ({
    ServiceName: record.Title,
    ServiceUrls: parseUrls(record.URL),
    Username: record.Username,
    Password: record.Password,
    TwoFactorSecret: record.OTPAuth,
    Notes: record.Notes,
  }));
}
