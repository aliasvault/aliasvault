import { readImportCsv } from '../../readers/CsvImport';
import { text } from '../../readers/CsvRecordMapper';
import { parseUrls } from '../../readers/FieldParsers';

import type { ImportedCredential } from '../../models/ImportedCredential';

const COLUMNS = {
  url: text,
  username: text,
  password: text,
};

/**
 * Import a Firefox Password Manager CSV export.
 * @param fileContent - The CSV file content
 * @returns The imported credentials
 * @throws {TypeError} When a URL cannot be parsed.
 */
export function importFirefoxCsv(fileContent: string): ImportedCredential[] {
  return readImportCsv(fileContent, COLUMNS).map(record => ({
    // Firefox has no title column, so the host of the URL without "www." names the service.
    ServiceName: new URL(record.url).hostname.replace(/^www\./, ''),
    ServiceUrls: parseUrls(record.url),
    Username: record.username,
    Password: record.password,
  }));
}
