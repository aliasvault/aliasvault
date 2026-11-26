import { ItemTypes } from '@aliasvault/models/vault';

import { nonBlank, nullIfBlank } from '../../../shared/StringUtils';
import { twoFactorCode } from '../../models/ImportedTwoFactorCode';
import { readImportCsv } from '../../readers/CsvImport';
import { optionalText, text } from '../../readers/CsvRecordMapper';
import { mapItemType, parseUrls } from '../../readers/FieldParsers';

import { applyProtonPassContent, getProtonPassLoginUrls, isProtonPassDefaultVault, parseProtonPassAutofillUrls, parseProtonPassCsvNoteContent } from './ProtonPassJson';

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
  identity: ItemTypes.Alias,
};

/** The row types whose note column holds their content as JSON. */
const JSON_NOTE_TYPES: ReadonlySet<string> = new Set(['creditcard', 'identity']);

/**
 * Import a Proton Pass CSV export.
 * @param fileContent - The CSV file content
 * @returns The imported credentials
 */
export function importProtonPassCsv(fileContent: string): ImportedCredential[] {
  return readImportCsv(fileContent, COLUMNS).map(record => {
    const credential: ImportedCredential = {
      ServiceName: record.name,
      ServiceUrls: readUrls(record.url, record.autofillUrls),
      Email: record.email,
      Username: record.username,
      Password: record.password,
      Notes: record.note,
      TwoFactorCodes: twoFactorCode(record.totp),
      // Every vault except the default one becomes a folder, as in the .zip import.
      FolderPath: isProtonPassDefaultVault(record.vault) ? null : nullIfBlank(record.vault),
      ItemType: mapItemType(record.type, ITEM_TYPES),
    };

    const noteContent = JSON_NOTE_TYPES.has(record.type.toLowerCase()) ? parseProtonPassCsvNoteContent(record.note) : null;
    if (noteContent) {
      credential.Notes = nullIfBlank(noteContent.Note);
      applyProtonPassContent(credential, record.type, noteContent.Content);
    }
    return credential;
  });
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
