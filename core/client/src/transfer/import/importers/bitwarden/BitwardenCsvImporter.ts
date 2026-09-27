import { ItemTypes } from '@aliasvault/models/vault';

import { nullIfBlank } from '../../../shared/StringUtils';
import { readImportCsv } from '../../readers/CsvImport';
import { optionalText, text } from '../../readers/CsvRecordMapper';
import { mapItemType, parseUrls } from '../../readers/FieldParsers';

import type { ImportedCredential } from '../../models/ImportedCredential';

const COLUMNS = {
  folder: text,
  type: text,
  name: text,
  notes: optionalText,
  login_uri: optionalText,
  login_username: optionalText,
  login_password: optionalText,
  login_totp: optionalText,
};

const ITEM_TYPES = {
  login: ItemTypes.Login,
  note: ItemTypes.Note,
  securenote: ItemTypes.Note,
  card: ItemTypes.CreditCard,
  identity: ItemTypes.Alias,
};

/**
 * Import a Bitwarden CSV export.
 * @param fileContent - The CSV file content
 * @returns The imported credentials
 */
export function importBitwardenCsv(fileContent: string): ImportedCredential[] {
  return readImportCsv(fileContent, COLUMNS).map(record => ({
    ServiceName: record.name,
    ServiceUrls: parseUrls(record.login_uri),
    Username: record.login_username,
    Password: record.login_password,
    TwoFactorSecret: record.login_totp,
    Notes: record.notes,
    FolderPath: nullIfBlank(record.folder),
    ItemType: mapItemType(record.type, ITEM_TYPES),
  }));
}
