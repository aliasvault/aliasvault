import { ItemTypes } from '@aliasvault/models/vault';

import { readImportCsv } from '../../readers/CsvImport';
import { dateTime, optionalText, text } from '../../readers/CsvRecordMapper';
import { parseUrls } from '../../readers/FieldParsers';

import type { ImportedCredential } from '../../models/ImportedCredential';

const COLUMNS = {
  Group: text,
  Title: text,
  Username: optionalText,
  Password: optionalText,
  URL: optionalText,
  Notes: optionalText,
  TOTP: optionalText,
  LastModified: dateTime,
  Created: dateTime,
};

/** The recycle bin group name; only the English name is detected. */
const RECYCLE_BIN_NAME = 'Recycle Bin';

/**
 * Import a KeePassXC CSV export. The root group becomes the vault root; the recycle bin is skipped.
 * @param fileContent - The CSV file content
 * @returns The imported credentials
 */
export function importKeePassXcCsv(fileContent: string): ImportedCredential[] {
  return readImportCsv(fileContent, COLUMNS).flatMap(record => {
    const groups = record.Group.split('/').slice(1);
    if (groups[0] === RECYCLE_BIN_NAME) {
      return [];
    }
    const urls = parseUrls(record.URL);
    const isNote = !record.Username && !record.Password && !urls && !record.TOTP;
    return [{
      ServiceName: record.Title,
      ServiceUrls: urls,
      Username: record.Username,
      Password: record.Password,
      TwoFactorSecret: record.TOTP,
      Notes: record.Notes,
      FolderPath: groups.length > 0 ? groups.join('/') : null,
      CreatedAt: record.Created,
      UpdatedAt: record.LastModified,
      ItemType: isNote ? ItemTypes.Note : ItemTypes.Login,
    }];
  });
}
