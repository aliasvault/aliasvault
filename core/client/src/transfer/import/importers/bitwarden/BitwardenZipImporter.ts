import { FieldTypes, ItemTypes, type ItemType } from '@aliasvault/models/vault';

import { isBlank, nonBlank } from '../../../shared/StringUtils';
import { ImportException, ImportStage } from '../../models/ImportException';
import { addAttachment, addCustomField, convertArchiveItems, openArchive, readArchiveJson } from '../../readers/ArchiveImport';
import { isJsonObject, readString, readStringAtPath, type JsonObject } from '../../readers/JsonReader';

import { BitwardenFieldTypes, BitwardenItemTypes, parseBitwardenItem, parseBitwardenJsonExport, type BitwardenIdentity, type BitwardenItem } from './BitwardenJson';

import type { ImportedCredential } from '../../models/ImportedCredential';
import type { ImportFileResult } from '../../models/ImportFileResult';

/** Bitwarden item types by number. */
const ITEM_TYPES: Readonly<Record<number, ItemType>> = {
  [BitwardenItemTypes.Login]: ItemTypes.Login,
  [BitwardenItemTypes.SecureNote]: ItemTypes.Note,
  [BitwardenItemTypes.Card]: ItemTypes.CreditCard,
  [BitwardenItemTypes.Identity]: ItemTypes.Alias,
  [BitwardenItemTypes.SshKey]: ItemTypes.Note,
  [BitwardenItemTypes.BankAccount]: ItemTypes.Note,
  [BitwardenItemTypes.DriversLicense]: ItemTypes.Note,
  [BitwardenItemTypes.Passport]: ItemTypes.Note,
};

const ATTACHMENTS_PATH = 'attachments/';

/**
 * Import a Bitwarden .zip export: data.json plus the attachments stored in a folder per item.
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
  const attachmentFolders = matchAttachmentFolders(exportData.Items, readAttachmentFolders(archive.filesUnder(ATTACHMENTS_PATH)));

  return convertArchiveItems(exportData.Items, element => {
    const item = parseBitwardenItem(element);
    const credential = convertItem(item, item.FolderId ? folderNames.get(item.FolderId) ?? null : null);
    for (const [filename, data] of attachmentFolders.get(element) ?? []) {
      addAttachment(credential, filename, data);
    }
    return credential;
  }, element => readStringAtPath(element, 'name'));
}

/**
 * Group the attachment files by their folder, the first path part below "attachments/".
 * @param files - The files under "attachments/"
 * @returns The files (file name to bytes) by folder name
 */
function readAttachmentFolders(files: Map<string, Uint8Array>): Map<string, Map<string, Uint8Array>> {
  const folders = new Map<string, Map<string, Uint8Array>>();
  for (const [path, data] of files) {
    const relative = path.substring(ATTACHMENTS_PATH.length);
    const separator = relative.indexOf('/');
    if (separator <= 0 || separator === relative.length - 1) {
      continue;
    }
    const folder = relative.substring(0, separator);
    const folderFiles = folders.get(folder) ?? new Map<string, Uint8Array>();
    folderFiles.set(relative.substring(separator + 1), data);
    folders.set(folder, folderFiles);
  }
  return folders;
}

/**
 * Find the attachment folder of each item: attachments/<item name>/, or attachments/<item id>/ when that folder exists.
 * @param items - The items as raw JSON, in export order
 * @param folders - The attachment files by folder name
 * @returns The attachment files of each item that has any, keyed by its raw JSON
 */
function matchAttachmentFolders(items: unknown[], folders: Map<string, Map<string, Uint8Array>>): Map<unknown, Map<string, Uint8Array>> {
  const matches = new Map<unknown, Map<string, Uint8Array>>();
  const foldersByLowerName = new Map([...folders].map(([name, files]) => [name.toLowerCase(), files]));
  const nameCounts = new Map<string, number>();
  for (const element of items) {
    if (!isJsonObject(element)) {
      continue;
    }

    const id = readString(element, 'id');
    const byId = isBlank(id) ? undefined : foldersByLowerName.get(id.toLowerCase());
    if (byId) {
      matches.set(element, byId);
      continue;
    }

    /*
     * The folder is the item name with /\><:"|?* replaced by "_", plus "_1", "_2" for later items with
     * the same name. Only items with attachments count for that suffix and data.json does not say which have any,
     * so same-named items take the numbered folders in export order.
     */
    const name = readString(element, 'name');
    if (name === null) {
      continue;
    }
    const count = nameCounts.get(name) ?? 0;
    const folderName = name.replace(/[/\\><:"|?*]/g, '_').replace(/__+/g, '_') + (count > 0 ? `_${count}` : '');
    const byName = folders.get(folderName);
    if (byName) {
      matches.set(element, byName);
      nameCounts.set(name, count + 1);
    }
  }
  return matches;
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

  // SSH keys, bank accounts, driver's licenses and passports have no associated AliasVault type so we add their fields as custom fields.
  if (item.Type === BitwardenItemTypes.SshKey && item.SshKey) {
    addSshKeyFields(credential, item.SshKey);
  } else if (item.Type === BitwardenItemTypes.BankAccount && item.BankAccount) {
    addBankAccountFields(credential, item.BankAccount);
  } else if (item.Type === BitwardenItemTypes.DriversLicense && item.DriversLicense) {
    addDriversLicenseFields(credential, item.DriversLicense);
  } else if (item.Type === BitwardenItemTypes.Passport && item.Passport) {
    addPassportFields(credential, item.Passport);
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

/**
 * Append a block of text to a credential's notes, separated by an empty line.
 * @param credential - The credential
 * @param lines - The lines to append.
 */
function appendNotes(credential: ImportedCredential, lines: string[]): void {
  if (lines.length === 0) {
    return;
  }
  const block = lines.join('\n');
  credential.Notes = isBlank(credential.Notes) ? block : `${credential.Notes}\n\n${block}`;
}

/**
 * Add the fields of an SSH key as custom fields.
 * @param credential - The credential to fill
 * @param key - The sshKey JSON
 */
function addSshKeyFields(credential: ImportedCredential, key: JsonObject): void {
  addCustomField(credential, 'Private key', readString(key, 'privateKey'), FieldTypes.Hidden);
  addCustomField(credential, 'Public key', readString(key, 'publicKey'));
  addCustomField(credential, 'Fingerprint', readString(key, 'keyFingerprint'));
}

/**
 * Add the fields of a bank account as custom fields.
 * @param credential - The credential to fill
 * @param bank - The bankAccount JSON
 */
function addBankAccountFields(credential: ImportedCredential, bank: JsonObject): void {
  addCustomField(credential, 'Bank name', readString(bank, 'bankName'));
  addCustomField(credential, 'Name on account', readString(bank, 'nameOnAccount'));
  addCustomField(credential, 'Account type', readString(bank, 'accountType'));
  addCustomField(credential, 'Account number', readString(bank, 'accountNumber'), FieldTypes.Hidden);
  addCustomField(credential, 'Routing number', readString(bank, 'routingNumber'));
  addCustomField(credential, 'Branch number', readString(bank, 'branchNumber'));
  addCustomField(credential, 'PIN', readString(bank, 'pin'), FieldTypes.Hidden);
  addCustomField(credential, 'SWIFT code', readString(bank, 'swiftCode'));
  addCustomField(credential, 'IBAN', readString(bank, 'iban'), FieldTypes.Hidden);
  addCustomField(credential, 'Bank contact phone', readString(bank, 'bankContactPhone'));
}

/**
 * Add the fields of a driver's license as custom fields.
 * @param credential - The credential to fill
 * @param license - The driversLicense JSON
 */
function addDriversLicenseFields(credential: ImportedCredential, license: JsonObject): void {
  addCustomField(credential, 'First name', readString(license, 'firstName'));
  addCustomField(credential, 'Middle name', readString(license, 'middleName'));
  addCustomField(credential, 'Last name', readString(license, 'lastName'));
  addCustomField(credential, 'Date of birth', readString(license, 'dateOfBirth'));
  addCustomField(credential, 'License number', readString(license, 'licenseNumber'));
  addCustomField(credential, 'Issuing country', readString(license, 'issuingCountry'));
  addCustomField(credential, 'Issuing state', readString(license, 'issuingState'));
  addCustomField(credential, 'Issue date', readString(license, 'issueDate'));
  addCustomField(credential, 'Expiration date', readString(license, 'expirationDate'));
  addCustomField(credential, 'Issuing authority', readString(license, 'issuingAuthority'));
  addCustomField(credential, 'License class', readString(license, 'licenseClass'));
}

/**
 * Add the fields of a passport as custom fields.
 * @param credential - The credential to fill
 * @param passport - The passport JSON
 */
function addPassportFields(credential: ImportedCredential, passport: JsonObject): void {
  addCustomField(credential, 'Surname', readString(passport, 'surname'));
  addCustomField(credential, 'Given name', readString(passport, 'givenName'));
  addCustomField(credential, 'Date of birth', readString(passport, 'dateOfBirth'));
  addCustomField(credential, 'Sex', readString(passport, 'sex'));
  addCustomField(credential, 'Place of birth', readString(passport, 'birthPlace'));
  addCustomField(credential, 'Nationality', readString(passport, 'nationality'));
  addCustomField(credential, 'Issuing country', readString(passport, 'issuingCountry'));
  addCustomField(credential, 'Passport number', readString(passport, 'passportNumber'));
  addCustomField(credential, 'Passport type', readString(passport, 'passportType'));
  addCustomField(credential, 'National identification number', readString(passport, 'nationalIdentificationNumber'));
  addCustomField(credential, 'Issuing authority', readString(passport, 'issuingAuthority'));
  addCustomField(credential, 'Issue date', readString(passport, 'issueDate'));
  addCustomField(credential, 'Expiration date', readString(passport, 'expirationDate'));
}
