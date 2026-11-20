import { FieldTypes, ItemTypes, type FieldType } from '@aliasvault/models/vault';

import { fromUnixTimeSeconds } from '../../../shared/DateTimeUtils';
import { buildFolderPath, type FolderNode } from '../../../shared/FolderPaths';
import { isBlank, nonBlank, nullIfBlank } from '../../../shared/StringUtils';
import { ImportException, ImportStage } from '../../models/ImportException';
import { addAttachment, addCustomField, convertArchiveItems, openArchive, readArchiveJson } from '../../readers/ArchiveImport';
import { mapItemType } from '../../readers/FieldParsers';
import { readStringAtPath } from '../../readers/JsonReader';
import { addPasskeys, rustPasskeyKeys, type PasskeyKeyConverter, type PendingPasskeys } from '../../readers/PasskeyImport';

import { ProtonPassItemStates, applyProtonPassContent, getProtonPassLoginUrls, isProtonPassDefaultVault, parseProtonPassItem, parseProtonPassJsonExport, type ProtonPassItem } from './ProtonPassJson';
import { readProtonPassPasskey } from './ProtonPassPasskey';

import type { ImportedCredential } from '../../models/ImportedCredential';
import type { ImportFileResult } from '../../models/ImportFileResult';

const DATA_JSON_PATH = 'Proton Pass/data.json';
const ENCRYPTED_DATA_PATH = 'Proton Pass/data.pgp';
const FILES_PATH = 'Proton Pass/files/';

/** The ".<hex export id>" Proton Pass inserts before the extension of an exported attachment name. */
const EXPORT_ID_PATTERN = /\.[0-9a-f]+(\.[^.]+)?$/;

/** The "yyyy-MM-dd" date of a timestamp field. */
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A Proton Pass alias is an email alias, not an identity, so it imports as a Login. */
const ITEM_TYPES = {
  login: ItemTypes.Login,
  note: ItemTypes.Note,
  alias: ItemTypes.Login,
  creditcard: ItemTypes.CreditCard,
  identity: ItemTypes.Alias,
};

/**
 * Import a Proton Pass .zip export. Every vault except the default one becomes a folder, with its own folders below it.
 * @param archiveBytes - The archive bytes
 * @param keys - Converts passkey keys, the Rust core by default
 * @returns The credentials and the items that could not be read
 * @throws {ImportException} When the archive cannot be opened, data.json cannot be read or the export is encrypted.
 */
export async function importProtonPassZip(archiveBytes: Uint8Array, keys: PasskeyKeyConverter = rustPasskeyKeys): Promise<ImportFileResult> {
  const archive = openArchive(archiveBytes);
  if (archive.has(ENCRYPTED_DATA_PATH)) {
    throw new ImportException(ImportStage.Parse, 'Encrypted Proton Pass exports (data.pgp) are not supported.');
  }

  const exportData = parseProtonPassJsonExport(readArchiveJson(archive, DATA_JSON_PATH));
  if (exportData.Encrypted) {
    throw new ImportException(ImportStage.Parse, 'Encrypted Proton Pass exports are not supported. Please export without a password.');
  }

  const vaults = [...exportData.Vaults.values()];
  const rootVault = vaults.find(vault => isProtonPassDefaultVault(vault.Name));
  const entries = vaults.flatMap(vault => {
    const foldersById = new Map<string, FolderNode>(vault.Folders.map(folder => [folder.FolderId ?? '', folder]));
    return vault.Items.map(element => ({ element, vaultPath: vault === rootVault ? null : vault.Name, foldersById }));
  });
  const files = archive.filesUnder(FILES_PATH);

  const pendingPasskeys: PendingPasskeys[] = [];
  const result = convertArchiveItems(entries, ({ element, vaultPath, foldersById }, index) => {
    const item = parseProtonPassItem(element);
    if (item.State === ProtonPassItemStates.Trashed || !item.Data) {
      return null;
    }
    const folderPath = [vaultPath, buildFolderPath(item.FolderId, foldersById)].filter(part => !isBlank(part)).join('/');
    const credential = convertItem(item, nullIfBlank(folderPath));
    addFiles(credential, item, files);
    const passkeys = item.Data.Type?.toLowerCase() === 'login' ? item.Data.Content?.Passkeys ?? [] : [];
    if (passkeys.length > 0) {
      pendingPasskeys.push({ Credential: credential, Index: index, Passkeys: passkeys });
    }
    return credential;
  }, ({ element }) => readStringAtPath(element, 'data', 'metadata', 'name'));

  return addPasskeys(result, pendingPasskeys, passkey => readProtonPassPasskey(passkey, keys));
}

/**
 * Convert a Proton Pass item to a credential.
 * @param item - The item, with its data
 * @param folderPath - The vault name, or null for the root folder
 * @returns The credential
 */
function convertItem(item: ProtonPassItem, folderPath: string | null): ImportedCredential {
  const data = item.Data!;
  const content = data.Content;
  const credential: ImportedCredential = {
    ServiceName: data.Metadata?.Name ?? null,
    Notes: data.Metadata?.Note ?? null,
    FolderPath: folderPath,
    CreatedAt: fromUnixTimeSeconds(item.CreateTime),
    UpdatedAt: fromUnixTimeSeconds(item.ModifyTime),
    ItemType: mapItemType(data.Type, ITEM_TYPES) ?? ItemTypes.Login,
  };

  switch (data.Type?.toLowerCase()) {
    case 'login':
      if (content) {
        credential.Username = nullIfBlank(content.ItemUsername);
        credential.Email = nullIfBlank(content.ItemEmail);
        credential.Password = nullIfBlank(content.Password);
        credential.TwoFactorSecret = nullIfBlank(content.TotpUri);
        const urls = nonBlank(getProtonPassLoginUrls(content.AutofillUrls, content.Urls));
        if (urls.length > 0) {
          credential.ServiceUrls = urls;
        }
      }
      break;
    case 'alias':
      // The generated address lives on the item envelope, not in the content.
      credential.Email = item.AliasEmail;
      credential.Username = item.AliasEmail;
      break;
    case 'creditcard':
    case 'identity':
      if (content) {
        applyProtonPassContent(credential, data.Type, content);
      }
      break;
  }

  for (const field of data.ExtraFields ?? []) {
    const value = field.Data?.Content ?? field.Data?.TotpUri ?? field.Data?.Timestamp ?? null;
    if (isBlank(value)) {
      continue;
    }

    // A TOTP field, or any field holding an otpauth:// URI, fills the 2FA slot when the login has none, named after the field.
    const type = field.Type?.toLowerCase();
    if ((type === 'totp' || value.toLowerCase().startsWith('otpauth://')) && isBlank(credential.TwoFactorSecret)) {
      credential.TwoFactorSecret = value;
      credential.TwoFactorName = nullIfBlank(field.FieldName);
      continue;
    }

    addCustomField(credential, field.FieldName, value, extraFieldType(type, value));
  }

  return credential;
}

/**
 * The AliasVault type of a custom field; a timestamp that is not a "yyyy-MM-dd" date stays text.
 * @param type - The Proton Pass field type, lowercase
 * @param value - The field value
 * @returns The field type
 */
function extraFieldType(type: string | undefined, value: string): FieldType {
  if (type === 'hidden') {
    return FieldTypes.Hidden;
  }
  return type === 'timestamp' && DATE_ONLY_PATTERN.test(value) ? FieldTypes.Date : FieldTypes.Text;
}

/**
 * Attach the files an item references.
 * @param credential - The credential to fill
 * @param item - The item
 * @param files - The archive's files under the files folder
 */
function addFiles(credential: ImportedCredential, item: ProtonPassItem, files: Map<string, Uint8Array>): void {
  for (const name of item.Files ?? []) {
    if (isBlank(name)) {
      continue;
    }

    const data = files.get(FILES_PATH + name.replace(/[/\\]/g, '_').trim());
    if (data) {
      addAttachment(credential, nullIfBlank(name.replace(EXPORT_ID_PATTERN, '$1')) ?? name, data);
    }
  }
}
