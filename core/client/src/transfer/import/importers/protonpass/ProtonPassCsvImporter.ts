import { ItemTypes } from '@aliasvault/models/vault';

import { nullIfBlank } from '../../../shared/StringUtils';
import { readImportCsv } from '../../readers/CsvImport';
import { optionalText, text } from '../../readers/CsvRecordMapper';
import { mapItemType, parseUrls } from '../shared/CredentialHelpers';

import type { ImportedCredential } from '../../models/ImportedCredential';

const COLUMNS = {
  type: text,
  name: text,
  url: text,
  email: text,
  username: text,
  password: text,
  note: optionalText,
  totp: optionalText,
  vault: text,
};

/** Proton Pass export types and their AliasVault equivalents. */
const ITEM_TYPES = {
  login: ItemTypes.Login,
  note: ItemTypes.Note,
  // A Proton Pass alias is an email alias, not an identity, so it imports as a standard Login type.
  alias: ItemTypes.Login,
  creditcard: ItemTypes.CreditCard,
};

/**
 * Import a Proton Pass CSV export.
 * @param fileContent - The CSV file content
 * @returns The imported credentials
 */
export function importProtonPassCsv(fileContent: string): ImportedCredential[] {
  return readImportCsv(fileContent, COLUMNS).map(record => ({
    ServiceName: record.name,
    ServiceUrls: parseUrls(record.url),
    Email: record.email,
    Username: record.username,
    Password: record.password,
    Notes: record.note,
    TwoFactorSecret: record.totp,
    // The vault becomes the folder.
    FolderPath: nullIfBlank(record.vault),
    ItemType: mapItemType(record.type, ITEM_TYPES),
  }));
}
