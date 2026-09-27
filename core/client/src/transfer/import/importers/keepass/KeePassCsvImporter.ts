import { readImportCsv } from '../../readers/CsvImport';
import { optionalText, text } from '../../readers/CsvRecordMapper';
import { parseUrls } from '../../readers/FieldParsers';

import type { ImportedCredential } from '../../models/ImportedCredential';

const COLUMNS = {
  Account: text,
  LoginName: optionalText,
  Password: optionalText,
  WebSite: optionalText,
  Comments: optionalText,
};

/**
 * Import a KeePass 1.x CSV export.
 * @param fileContent - The CSV file content
 * @returns The imported credentials
 */
export function importKeePassCsv(fileContent: string): ImportedCredential[] {
  return readImportCsv(fileContent, COLUMNS, decodeKeePassField).map(record => ({
    ServiceName: record.Account,
    ServiceUrls: parseUrls(record.WebSite),
    Username: record.LoginName,
    Password: record.Password,
    Notes: record.Comments,
  }));
}

/**
 * Decode KeePass 1.x field encoding, which writes quotes as \" and backslashes as \\.
 * @param value - The field value
 * @returns The decoded value
 */
function decodeKeePassField(value: string): string {
  return value.replace(/\\(["\\])/g, '$1');
}
