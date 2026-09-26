import { nullIfBlank } from '../../../shared/StringUtils';
import { readImportCsv } from '../../readers/CsvImport';
import { optionalText, text } from '../../readers/CsvRecordMapper';
import { parseUrls } from '../shared/CredentialHelpers';

import type { ImportedCredential } from '../../models/ImportedCredential';

const COLUMNS = {
  Title: text,
  Url: text,
  Username: text,
  Password: text,
  OTPAuth: optionalText,
  Tags: optionalText,
  Notes: optionalText,
};

/**
 * Import a 1Password CSV export. The tags become the folder.
 * @param fileContent - The CSV file content
 * @returns The imported credentials
 */
export function importOnePasswordCsv(fileContent: string): ImportedCredential[] {
  return readImportCsv(fileContent, COLUMNS).map(record => ({
    ServiceName: record.Title,
    ServiceUrls: parseUrls(record.Url),
    Username: record.Username,
    Password: record.Password,
    TwoFactorSecret: record.OTPAuth,
    Notes: record.Notes,
    FolderPath: nullIfBlank(record.Tags),
  }));
}
