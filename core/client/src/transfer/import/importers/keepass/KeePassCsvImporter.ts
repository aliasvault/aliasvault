import { ItemTypes } from '@aliasvault/models/vault';

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
  return readImportCsv(toStandardCsv(fileContent), COLUMNS).map(record => {
    const urls = parseUrls(record.WebSite);
    return {
      ServiceName: record.Account,
      ServiceUrls: urls,
      Username: record.LoginName,
      Password: record.Password,
      Notes: record.Comments,
      ItemType: !record.LoginName && !record.Password && !urls ? ItemTypes.Note : ItemTypes.Login,
    };
  });
}

/**
 * Convert KeePass escaping (\" and \\ inside quoted fields) to standard CSV quoting ("").
 * @param fileContent - The CSV file content
 * @returns The content as standard CSV
 */
function toStandardCsv(fileContent: string): string {
  return fileContent.replace(/\\(["\\])/g, (_, char: string) => (char === '"' ? '""' : '\\'));
}
