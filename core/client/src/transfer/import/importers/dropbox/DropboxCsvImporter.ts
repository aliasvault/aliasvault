import { isBlank } from '../../../shared/StringUtils';
import { readImportCsv } from '../../readers/CsvImport';
import { optionalText, text } from '../../readers/CsvRecordMapper';
import { parseUrls } from '../../readers/FieldParsers';

import type { ImportedCredential } from '../../models/ImportedCredential';

const COLUMNS = {
  Name: text,
  URL: optionalText,
  Username: optionalText,
  Password: optionalText,
  Notes: optionalText,
};

/**
 * Import a Dropbox Passwords CSV export.
 * @param fileContent - The CSV file content
 * @returns The imported credentials
 */
export function importDropboxCsv(fileContent: string): ImportedCredential[] {
  return readImportCsv(fileContent, COLUMNS).filter(record => !isBlank(record.Name)).map(record => ({
    ServiceName: record.Name,
    ServiceUrls: parseUrls(record.URL),
    Username: record.Username,
    Password: record.Password,
    Notes: record.Notes,
  }));
}
