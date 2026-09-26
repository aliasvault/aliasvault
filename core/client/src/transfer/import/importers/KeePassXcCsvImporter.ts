import { nullIfBlank } from '../../shared/StringUtils';
import { readImportCsv } from '../readers/CsvImport';
import { optionalText, text } from '../readers/CsvRecordMapper';

import { parseUrls } from './shared/CredentialHelpers';

import type { ImportedCredential } from '../models/ImportedCredential';

const COLUMNS = {
  Group: text,
  Title: text,
  Username: optionalText,
  Password: optionalText,
  URL: optionalText,
  Notes: optionalText,
  TOTP: optionalText,
};

/**
 * Import a KeePassXC CSV export.
 * @param fileContent - The CSV file content
 * @returns The imported credentials
 */
export function importKeePassXcCsv(fileContent: string): ImportedCredential[] {
  return readImportCsv(fileContent, COLUMNS).map(record => ({
    ServiceName: record.Title,
    ServiceUrls: parseUrls(record.URL),
    Username: record.Username,
    Password: record.Password,
    TwoFactorSecret: record.TOTP,
    Notes: record.Notes,
    FolderPath: nullIfBlank(record.Group),
  }));
}
