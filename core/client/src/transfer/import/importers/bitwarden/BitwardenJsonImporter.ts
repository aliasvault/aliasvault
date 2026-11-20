import { FieldTypes, ItemTypes, type ItemType } from '@aliasvault/models/vault';

import { isBlank, nonBlank } from '../../../shared/StringUtils';
import { ImportException, ImportStage } from '../../models/ImportException';
import { addAttachment, addCustomField, convertArchiveItems } from '../../readers/ArchiveImport';
import { parseJson, readString, readStringAtPath, type JsonObject } from '../../readers/JsonReader';
import { addPasskeys, rustPasskeyKeys, type PasskeyKeyConverter, type PendingPasskeys } from '../../readers/PasskeyImport';

import { BitwardenFieldTypes, BitwardenItemTypes, parseBitwardenItem, parseBitwardenJsonExport, type BitwardenIdentity, type BitwardenItem, type BitwardenJsonExport } from './BitwardenJson';
import { readBitwardenPasskey } from './BitwardenPasskey';

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

/**
 * Import a Bitwarden .json export, with the passkeys of its logins. It holds the same data as a .zip export, without the attachments.
 * @param fileContent - The JSON file content
 * @param keys - Converts passkey keys, the Rust core by default
 * @returns The credentials and the items that could not be read
 * @throws {ImportException} When the file is not a Bitwarden JSON export or the export is encrypted.
 */
export async function importBitwardenJson(fileContent: string, keys: PasskeyKeyConverter = rustPasskeyKeys): Promise<ImportFileResult> {
  let exportData: BitwardenJsonExport;
  try {
    exportData = parseBitwardenJsonExport(parseJson(fileContent));
  } catch (error) {
    throw new ImportException(ImportStage.Parse, `Failed to parse the Bitwarden export: ${error instanceof Error ? error.message : String(error)}`, error);
  }
  return importBitwardenExport(exportData, keys);
}

/**
 * Convert the items of a Bitwarden JSON export, with the passkeys of its logins.
 * @param exportData - The export
 * @param keys - Converts passkey keys
 * @param attachmentsOf - The attachment files (file name to bytes) of an item, given its raw JSON
 * @returns The credentials and the items that could not be read
 * @throws {ImportException} When the export is encrypted.
 */
export async function importBitwardenExport(exportData: BitwardenJsonExport, keys: PasskeyKeyConverter, attachmentsOf: (element: unknown) => Map<string, Uint8Array> | undefined = () => undefined): Promise<ImportFileResult> {
  if (exportData.Encrypted) {
    throw new ImportException(ImportStage.Parse, 'Encrypted Bitwarden exports are not supported. Please export as unencrypted.');
  }

  const folderNames = new Map(exportData.Folders.filter(folder => !isBlank(folder.Id) && !isBlank(folder.Name)).map(folder => [folder.Id!, folder.Name!]));
  const pendingPasskeys: PendingPasskeys[] = [];
  const result = convertArchiveItems(exportData.Items, (element, index) => {
    const item = parseBitwardenItem(element);
    const credential = convertItem(item, item.FolderId ? folderNames.get(item.FolderId) ?? null : null);
    for (const [filename, data] of attachmentsOf(element) ?? []) {
      addAttachment(credential, filename, data);
    }
    if (credential.ItemType === ItemTypes.Login && item.Login && item.Login.Fido2Credentials.length > 0) {
      pendingPasskeys.push({ Credential: credential, Index: index, Passkeys: item.Login.Fido2Credentials });
    }
    return credential;
  }, element => readStringAtPath(element, 'name'));

  return addPasskeys(result, pendingPasskeys, passkey => readBitwardenPasskey(passkey, keys));
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
    CreatedAt: item.CreationDate,
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
 * Take the name and email of an identity, and its title, company, phone and address as custom fields.
 * @param credential - The credential to fill
 * @param identity - The identity
 */
function applyIdentity(credential: ImportedCredential, identity: BitwardenIdentity): void {
  credential.Alias = { FirstName: identity.FirstName, LastName: identity.LastName };
  credential.Email = identity.Email;

  addCustomField(credential, 'Title', identity.Title);
  addCustomField(credential, 'Company', identity.Company);
  addCustomField(credential, 'Phone', identity.Phone, FieldTypes.Phone);
  addCustomField(credential, 'Address', nonBlank([identity.Address1, identity.Address2, identity.Address3, identity.City, identity.State, identity.PostalCode, identity.Country]).join(', '));
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
