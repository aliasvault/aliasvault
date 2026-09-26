import { FieldTypes, ItemTypes, type ItemType } from '@aliasvault/models/vault';

import { isBlank, nonBlank } from '../../../shared/StringUtils';
import { ImportException, ImportStage } from '../../models/ImportException';
import { readStringAtPath } from '../../readers/JsonReader';
import { convertArchiveItems, openArchive, readArchiveJson } from '../shared/ArchiveImport';
import { addCustomField, appendNotes } from '../shared/CredentialHelpers';

import { BitwardenFieldTypes, BitwardenItemTypes, parseBitwardenItem, parseBitwardenJsonExport, type BitwardenIdentity, type BitwardenItem } from './BitwardenJson';

import type { ImportedCredential } from '../../models/ImportedCredential';
import type { ImportFileResult } from '../../models/ImportFileResult';

/** Bitwarden item types by number. */
const ITEM_TYPES: Readonly<Record<number, ItemType>> = {
  [BitwardenItemTypes.Login]: ItemTypes.Login,
  [BitwardenItemTypes.SecureNote]: ItemTypes.Note,
  [BitwardenItemTypes.Card]: ItemTypes.CreditCard,
  [BitwardenItemTypes.Identity]: ItemTypes.Alias,
};

/**
 * Import a Bitwarden .zip export: data.json plus the attachments stored as attachments/<item id>/<file name>.
 * @param archiveBytes - The archive bytes
 * @returns The credentials and the items that could not be read
 * @throws {ImportException} When the archive cannot be opened, data.json cannot be read or the export is encrypted.
 */
export function importBitwardenZip(archiveBytes: Uint8Array): ImportFileResult {
  const archive = openArchive(archiveBytes);
  const exportData = parseBitwardenJsonExport(readArchiveJson(archive, 'data.json'));
  if (exportData.Encrypted) {
    throw new ImportException(ImportStage.Parse, 'Encrypted Bitwarden exports are not supported. Please export as unencrypted.');
  }

  const folderNames = new Map(exportData.Folders.filter(folder => !isBlank(folder.Id) && !isBlank(folder.Name)).map(folder => [folder.Id!, folder.Name!]));
  const attachments = archive.filesUnder('attachments/');

  return convertArchiveItems(exportData.Items, element => {
    const item = parseBitwardenItem(element);
    const credential = convertItem(item, item.FolderId ? folderNames.get(item.FolderId) ?? null : null);

    if (!isBlank(item.Id)) {
      const prefix = `attachments/${item.Id}/`.toLowerCase();
      const itemAttachments = [...attachments].filter(([path]) => path.toLowerCase().startsWith(prefix));
      if (itemAttachments.length > 0) {
        credential.Attachments = itemAttachments.map(([path, data]) => ({ Filename: path.substring(prefix.length), Blob: data }));
      }
    }
    return credential;
  }, element => readStringAtPath(element, 'name'));
}

/**
 * Convert a Bitwarden item to a credential.
 * @param item - The item
 * @param folderPath - The name of the item's folder, or null
 * @returns The credential
 */
function convertItem(item: BitwardenItem, folderPath: string | null): ImportedCredential {
  const credential: ImportedCredential = {
    ServiceName: item.Name,
    Notes: item.Notes,
    UpdatedAt: item.RevisionDate,
    FolderPath: folderPath,
    ItemType: ITEM_TYPES[item.Type] ?? ItemTypes.Login,
  };

  if (credential.ItemType === ItemTypes.Login && item.Login) {
    credential.Username = item.Login.Username;
    credential.Password = item.Login.Password;
    credential.TwoFactorSecret = item.Login.Totp;
    if (item.Login.Uris && item.Login.Uris.length > 0) {
      credential.ServiceUrls = nonBlank(item.Login.Uris.map(uri => uri.Uri));
    }
  } else if (credential.ItemType === ItemTypes.CreditCard && item.Card) {
    credential.Creditcard = { CardholderName: item.Card.CardholderName, Number: item.Card.Number, ExpiryMonth: item.Card.ExpMonth, ExpiryYear: item.Card.ExpYear, Cvv: item.Card.Code };
  } else if (credential.ItemType === ItemTypes.Alias && item.Identity) {
    applyIdentity(credential, item.Identity);
  }

  // Linked fields point at another field of the item and have no value of their own.
  for (const field of item.Fields ?? []) {
    if (field.Type !== BitwardenFieldTypes.Linked) {
      addCustomField(credential, field.Name, field.Value, field.Type === BitwardenFieldTypes.Hidden ? FieldTypes.Hidden : FieldTypes.Text);
    }
  }

  return credential;
}

/**
 * Take the name and email of an identity; the details without a field of their own go into the notes.
 * @param credential - The credential to fill
 * @param identity - The identity
 */
function applyIdentity(credential: ImportedCredential, identity: BitwardenIdentity): void {
  credential.Alias = { FirstName: identity.FirstName, LastName: identity.LastName };
  credential.Email = identity.Email;

  const address = nonBlank([identity.Address1, identity.Address2, identity.Address3, identity.City, identity.State, identity.PostalCode, identity.Country]).join(', ');
  const details: [string, string | null][] = [['Title', identity.Title], ['Company', identity.Company], ['Phone', identity.Phone], ['Address', address]];
  appendNotes(credential, details.filter(([, value]) => !isBlank(value)).map(([label, value]) => `${label}: ${value}`));
}
