import { FieldTypes, ItemTypes } from '@aliasvault/models/vault';

import { fromUnixTimeSeconds } from '../../../shared/DateTimeUtils';
import { buildFolderPath, type FolderNode } from '../../../shared/FolderPaths';
import { isBlank, nonBlank, nullIfBlank } from '../../../shared/StringUtils';
import { ImportException, ImportStage } from '../../models/ImportException';
import { addAttachment, addCustomField, convertArchiveItems, openArchive, readArchiveJson } from '../../readers/ArchiveImport';
import { mapItemType } from '../../readers/FieldParsers';
import { readStringAtPath } from '../../readers/JsonReader';

import { ProtonPassItemStates, getProtonPassLoginUrls, parseProtonPassItem, parseProtonPassJsonExport, type ProtonPassContent, type ProtonPassItem } from './ProtonPassJson';

import type { ImportedCredential } from '../../models/ImportedCredential';
import type { ImportedCreditcard } from '../../models/ImportedCreditcard';
import type { ImportFileResult } from '../../models/ImportFileResult';

const DATA_JSON_PATH = 'Proton Pass/data.json';
const ENCRYPTED_DATA_PATH = 'Proton Pass/data.pgp';
const FILES_PATH = 'Proton Pass/files/';

/** The default vault; its items go to the root folder instead of a "Personal" folder. */
const DEFAULT_VAULT_NAME = 'personal';

/** The ".<hex export id>" Proton Pass inserts before the extension of an exported attachment name. */
const EXPORT_ID_PATTERN = /\.[0-9a-f]+(\.[^.]+)?$/;

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
 * @returns The credentials and the items that could not be read
 * @throws {ImportException} When the archive cannot be opened, data.json cannot be read or the export is encrypted.
 */
export function importProtonPassZip(archiveBytes: Uint8Array): ImportFileResult {
  const archive = openArchive(archiveBytes);
  if (archive.has(ENCRYPTED_DATA_PATH)) {
    throw new ImportException(ImportStage.Parse, 'Encrypted Proton Pass exports (data.pgp) are not supported.');
  }

  const exportData = parseProtonPassJsonExport(readArchiveJson(archive, DATA_JSON_PATH));
  if (exportData.Encrypted) {
    throw new ImportException(ImportStage.Parse, 'Encrypted Proton Pass exports are not supported. Please export without a password.');
  }

  const vaults = [...exportData.Vaults.values()];
  const rootVault = vaults.find(vault => vault.Name?.toLowerCase() === DEFAULT_VAULT_NAME);
  const entries = vaults.flatMap(vault => {
    const foldersById = new Map<string, FolderNode>(vault.Folders.map(folder => [folder.FolderId ?? '', folder]));
    return vault.Items.map(element => ({ element, vaultPath: vault === rootVault ? null : vault.Name, foldersById }));
  });
  const files = archive.filesUnder(FILES_PATH);

  return convertArchiveItems(entries, ({ element, vaultPath, foldersById }) => {
    const item = parseProtonPassItem(element);
    if (item.State === ProtonPassItemStates.Trashed || !item.Data) {
      return null;
    }
    const folderPath = [vaultPath, buildFolderPath(item.FolderId, foldersById)].filter(part => !isBlank(part)).join('/');
    const credential = convertItem(item, nullIfBlank(folderPath));
    addFiles(credential, item, files);
    return credential;
  }, ({ element }) => readStringAtPath(element, 'data', 'metadata', 'name'));
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
      if (content) {
        credential.Creditcard = {
          CardholderName: nullIfBlank(content.CardholderName),
          Number: nullIfBlank(content.Number),
          Cvv: nullIfBlank(content.VerificationNumber),
          Pin: nullIfBlank(content.Pin),
          ...parseExpirationDate(content.ExpirationDate),
        };
      }
      break;
    case 'identity':
      if (content) {
        applyIdentity(credential, content);
      }
      break;
  }

  for (const field of data.ExtraFields ?? []) {
    const value = field.Data?.Content;
    if (isBlank(field.FieldName) || isBlank(value)) {
      continue;
    }

    // A TOTP field, or any field holding an otpauth:// URI, fills the 2FA slot when the login has none.
    const type = field.Type?.toLowerCase();
    if ((type === 'totp' || value.toLowerCase().startsWith('otpauth://')) && isBlank(credential.TwoFactorSecret)) {
      credential.TwoFactorSecret = value;
      continue;
    }

    addCustomField(credential, field.FieldName, value, type === 'hidden' ? FieldTypes.Hidden : FieldTypes.Text);
  }

  return credential;
}

/**
 * Split a Proton Pass expiration, written as "YYYY-MM" (or "MMYY" by older versions), into month and year.
 * @param expirationDate - The expiration text
 * @returns The month and year, empty when the format is not recognised
 */
function parseExpirationDate(expirationDate: string | null): Pick<ImportedCreditcard, 'ExpiryMonth' | 'ExpiryYear'> {
  const value = expirationDate?.trim() ?? '';
  const yearMonth = /^(\d{4})-(\d{1,2})$/.exec(value);
  if (yearMonth) {
    return { ExpiryYear: yearMonth[1], ExpiryMonth: yearMonth[2].padStart(2, '0') };
  }
  const monthYear = /^(\d{2})(\d{2})$/.exec(value);
  return monthYear ? { ExpiryMonth: monthYear[1], ExpiryYear: `20${monthYear[2]}` } : {};
}

/**
 * Take the name and email of an identity; without first and last name, the full name splits on its first space.
 * @param credential - The credential to fill
 * @param content - The identity content
 */
function applyIdentity(credential: ImportedCredential, content: ProtonPassContent): void {
  let firstName = content.FirstName;
  let lastName = content.LastName;
  if (isBlank(firstName) && isBlank(lastName) && !isBlank(content.FullName)) {
    const [first, ...rest] = content.FullName.split(' ').filter(part => part.length > 0);
    firstName = first ?? null;
    lastName = rest.length > 0 ? rest.join(' ') : null;
  }

  credential.Alias = { FirstName: nullIfBlank(firstName), LastName: nullIfBlank(lastName) };
  if (!isBlank(content.Email)) {
    credential.Email = content.Email;
  }
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
