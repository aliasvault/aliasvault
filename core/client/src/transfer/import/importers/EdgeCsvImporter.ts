import { readImportCsv } from '../readers/CsvImport';
import { optionalText, text } from '../readers/CsvRecordMapper';

import { parseUrls } from './shared/CredentialHelpers';

import type { ImportedCredential } from '../models/ImportedCredential';

const COLUMNS = {
  name: text,
  url: text,
  username: text,
  password: text,
  note: optionalText,
};

/**
 * Import a Microsoft Edge Password Manager CSV export.
 * @param fileContent - The CSV file content
 * @returns The imported credentials
 */
export function importEdgeCsv(fileContent: string): ImportedCredential[] {
  return readImportCsv(fileContent, COLUMNS).map(record => ({
    ServiceName: record.name,
    ServiceUrls: parseUrls(record.url),
    Username: record.username,
    Password: record.password,
    Notes: record.note,
  }));
}
