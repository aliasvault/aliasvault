import { ItemTypes } from '@aliasvault/models/vault';

import { nullIfBlank } from '../../../shared/StringUtils';
import { addCustomField } from '../../readers/ArchiveImport';
import { readImportCsv } from '../../readers/CsvImport';
import { optionalText, text } from '../../readers/CsvRecordMapper';
import { mapItemType, parseUrls } from '../../readers/FieldParsers';

import type { ImportedCredential } from '../../models/ImportedCredential';

const COLUMNS = {
  folder: text,
  type: text,
  name: text,
  notes: optionalText,
  fields: optionalText,
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

/** Separates the name of a custom field from its value in the fields column. */
const FIELD_SEPARATOR = ': ';

/**
 * Import a Bitwarden CSV export.
 * @param fileContent - The CSV file content
 * @returns The imported credentials
 */
export function importBitwardenCsv(fileContent: string): ImportedCredential[] {
  return readImportCsv(fileContent, COLUMNS).map(record => {
    const credential: ImportedCredential = {
      ServiceName: record.name,
      ServiceUrls: parseUrls(record.login_uri),
      Username: record.login_username,
      Password: record.login_password,
      TwoFactorSecret: record.login_totp,
      Notes: record.notes,
      FolderPath: nullIfBlank(record.folder),
      ItemType: mapItemType(record.type, ITEM_TYPES),
    };
    addCustomFields(credential, record.fields);
    return credential;
  });
}

/**
 * Add the custom fields of the fields column, one "name: value" line each. The CSV does not say which fields are hidden, so all are text.
 * @param credential - The credential
 * @param fields - The fields column
 */
function addCustomFields(credential: ImportedCredential, fields: string | null): void {
  for (const line of (fields ?? '').split(/\r?\n/)) {
    const separator = line.indexOf(FIELD_SEPARATOR);
    if (separator >= 0) {
      addCustomField(credential, line.substring(0, separator), line.substring(separator + FIELD_SEPARATOR.length));
    }
  }
}
