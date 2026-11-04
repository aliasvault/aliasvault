import { ItemTypes } from '@aliasvault/models/vault';

import { nonBlank, nullIfBlank } from '../../../shared/StringUtils';
import { readImportCsv } from '../../readers/CsvImport';
import { optionalText, text } from '../../readers/CsvRecordMapper';
import { mapItemType, parseUrls } from '../../readers/FieldParsers';

import { getProtonPassLoginUrls, parseProtonPassAutofillUrls } from './ProtonPassJson';

import type { ImportedCredential } from '../../models/ImportedCredential';

const COLUMNS = {
  type: text,
  name: text,
  url: text,
  autofillUrls: optionalText,
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
    ServiceUrls: readUrls(record.url, record.autofillUrls),
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

/**
 * The website URLs of a row, from the autofillUrls column when it has any.
 * @param url - The url column, comma separated
 * @param autofillUrls - The autofillUrls column
 * @returns The URLs, or null when there are none
 */
function readUrls(url: string, autofillUrls: string | null): string[] | null {
  const urls = nonBlank(getProtonPassLoginUrls(parseProtonPassAutofillUrls(autofillUrls), parseUrls(url)));
  return urls.length > 0 ? urls : null;
}
