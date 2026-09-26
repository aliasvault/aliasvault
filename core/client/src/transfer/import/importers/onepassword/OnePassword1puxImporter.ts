import { FieldTypes, ItemTypes, type FieldType, type ItemType } from '@aliasvault/models/vault';

import { formatDateOnly, fromUnixTimeSeconds } from '../../../shared/DateTimeUtils';
import { isBlank, nonBlank, nullIfBlank } from '../../../shared/StringUtils';
import { ImportException, ImportStage } from '../../models/ImportException';
import { readStringAtPath } from '../../readers/JsonReader';
import { convertArchiveItems, openArchive, readArchiveJson } from '../shared/ArchiveImport';
import { addAttachment, addCustomField } from '../shared/CredentialHelpers';

import { OnePasswordCategories, OnePasswordPersonalVaultType, parseOnePassword1puxAttributes, parseOnePassword1puxData, parseOnePasswordItem, type OnePasswordField, type OnePasswordFieldValue, type OnePasswordItem, type OnePasswordVault } from './OnePassword1pux';

import type { ImportedAlias } from '../../models/ImportedAlias';
import type { ImportedCredential } from '../../models/ImportedCredential';
import type { ImportedCreditcard } from '../../models/ImportedCreditcard';
import type { ImportFileResult } from '../../models/ImportFileResult';

/** The only .1pux format version this importer reads. */
const SUPPORTED_VERSION = 3;

/** 1Password categories by id; anything else imports as a Login. */
const ITEM_TYPES: Readonly<Record<string, ItemType>> = {
  [OnePasswordCategories.Login]: ItemTypes.Login,
  [OnePasswordCategories.CreditCard]: ItemTypes.CreditCard,
  [OnePasswordCategories.SecureNote]: ItemTypes.Note,
  [OnePasswordCategories.Identity]: ItemTypes.Alias,
  [OnePasswordCategories.Password]: ItemTypes.Login,
  [OnePasswordCategories.Document]: ItemTypes.Note,
};

/** The built-in vaults; the first one holding items goes to the root folder instead of becoming a folder. */
const DEFAULT_VAULT_NAMES = new Set(['private', 'personal', 'employee']);

/** Identity fields by lower case field title. */
const IDENTITY_FIELDS: Readonly<Record<string, 'FirstName' | 'LastName' | 'Gender'>> = {
  'first name': 'FirstName',
  firstname: 'FirstName',
  'last name': 'LastName',
  lastname: 'LastName',
  gender: 'Gender',
  sex: 'Gender',
};
const BIRTH_DATE_TITLES = new Set(['birth date', 'birthdate', 'date of birth']);

/** Credit card fields by lower case field title. */
const CARD_FIELDS: Readonly<Record<string, 'CardholderName' | 'Number' | 'Cvv' | 'Pin'>> = {
  'cardholder name': 'CardholderName',
  cardholder: 'CardholderName',
  'name on card': 'CardholderName',
  number: 'Number',
  'card number': 'Number',
  cardnumber: 'Number',
  cvv: 'Cvv',
  'verification number': 'Cvv',
  'security code': 'Cvv',
  cvc: 'Cvv',
  pin: 'Pin',
  'pin code': 'Pin',
};
const EXPIRY_TITLES = new Set(['expiry date', 'expiration date', 'expires']);

/** The text members of a field value in the order they are tried, with the field type each maps to. */
const TEXT_VALUE_MEMBERS: readonly ['String' | 'Concealed' | 'Url' | 'CreditCardNumber' | 'Menu' | 'Phone', FieldType][] = [
  ['String', FieldTypes.Text],
  ['Concealed', FieldTypes.Hidden],
  ['Url', FieldTypes.URL],
  ['CreditCardNumber', FieldTypes.Text],
  ['Menu', FieldTypes.Text],
  ['Phone', FieldTypes.Phone],
];

/**
 * Import a 1Password .1pux export. Every vault except the default one becomes a folder; attachments are stored as
 * files/<document id>__<file name>.
 * @param archiveBytes - The archive bytes
 * @returns The credentials and the items that could not be read
 * @throws {ImportException} When the archive cannot be opened, export.data cannot be read or the format version is unsupported.
 */
export function importOnePassword1pux(archiveBytes: Uint8Array): ImportFileResult {
  const archive = openArchive(archiveBytes);
  if (archive.has('export.attributes')) {
    const attributes = parseOnePassword1puxAttributes(readArchiveJson(archive, 'export.attributes'));
    if (attributes.Version !== SUPPORTED_VERSION) {
      throw new ImportException(ImportStage.Parse, `Unsupported 1Password export version: ${attributes.Version}. Expected version ${SUPPORTED_VERSION}.`);
    }
  }

  const vaults = parseOnePassword1puxData(readArchiveJson(archive, 'export.data')).Accounts.flatMap(account => account.Vaults);
  const rootVaultName = vaults.find(isRootVault)?.Attrs?.Name?.toLowerCase();
  const entries = vaults.flatMap(vault => {
    const vaultName = vault.Attrs?.Name ?? null;
    return vault.Items.map(element => ({ element, folderPath: vaultName?.toLowerCase() === rootVaultName ? null : vaultName }));
  });
  const files = archive.filesUnder('files/');

  return convertArchiveItems(entries, ({ element, folderPath }) => convertItem(parseOnePasswordItem(element), folderPath, files), ({ element }) => readStringAtPath(element, 'overview', 'title'));
}

/**
 * Whether a vault is a built-in one holding items, whose items go to the root folder.
 * @param vault - The vault
 * @returns True for the root vault candidate
 */
function isRootVault(vault: OnePasswordVault): boolean {
  const name = vault.Attrs?.Name;
  return vault.Items.length > 0 && !isBlank(name) && (DEFAULT_VAULT_NAMES.has(name.toLowerCase()) || vault.Attrs?.Type === OnePasswordPersonalVaultType);
}

/**
 * Convert a 1Password item to a credential.
 * @param item - The item
 * @param folderPath - The vault name, or null for the root folder
 * @param files - The archive's files under files/
 * @returns The credential
 */
function convertItem(item: OnePasswordItem, folderPath: string | null, files: Map<string, Uint8Array>): ImportedCredential {
  const credential: ImportedCredential = {
    ServiceName: item.Overview?.Title ?? null,
    Notes: item.Details?.NotesPlain ?? null,
    FolderPath: folderPath,
    CreatedAt: fromUnixTimeSeconds(item.CreatedAt),
    UpdatedAt: fromUnixTimeSeconds(item.UpdatedAt),
    ItemType: item.CategoryUuid && Object.hasOwn(ITEM_TYPES, item.CategoryUuid) ? ITEM_TYPES[item.CategoryUuid] : ItemTypes.Login,
  };

  if (item.Overview?.Urls && item.Overview.Urls.length > 0) {
    credential.ServiceUrls = nonBlank(item.Overview.Urls.map(url => url.Url));
  }
  if (item.Overview?.Tags && item.Overview.Tags.length > 0) {
    credential.Tags = nonBlank(item.Overview.Tags);
  }

  for (const field of item.Details?.LoginFields ?? []) {
    if (field.Designation === 'username' && !isBlank(field.Value)) {
      credential.Username = field.Value;
    } else if (field.Designation === 'password' && !isBlank(field.Value)) {
      credential.Password = field.Value;
    }
  }

  for (const field of (item.Details?.Sections ?? []).flatMap(section => section.Fields ?? [])) {
    applySectionField(credential, field, files);
  }

  const document = item.Details?.DocumentAttributes;
  if (document && !isBlank(document.DocumentId) && !isBlank(document.FileName)) {
    const data = files.get(`files/${document.DocumentId}__${document.FileName}`);
    if (data) {
      addAttachment(credential, document.FileName, data);
    }
  }

  if (!isBlank(item.Uuid)) {
    const prefix = `files/${item.Uuid}__`.toLowerCase();
    for (const [path, data] of files) {
      if (path.toLowerCase().startsWith(prefix)) {
        addAttachment(credential, path.substring(prefix.length), data);
      }
    }
  }

  return credential;
}

/**
 * Apply one section field: a file becomes an attachment, a TOTP field the 2FA secret, and every other field a
 * custom field, after identity and card fields have also filled their own slots.
 * @param credential - The credential to fill
 * @param field - The field
 * @param files - The archive's files under files/
 */
function applySectionField(credential: ImportedCredential, field: OnePasswordField, files: Map<string, Uint8Array>): void {
  const value = field.Value;
  if (!value) {
    return;
  }

  if (value.File && !isBlank(value.File.DocumentId) && !isBlank(value.File.FileName)) {
    const data = files.get(`files/${value.File.DocumentId}__${value.File.FileName}`);
    if (data) {
      addAttachment(credential, value.File.FileName, data);
    }
    return;
  }

  if (isBlank(field.Title)) {
    return;
  }

  if (!isBlank(value.Totp)) {
    credential.TwoFactorSecret = value.Totp;
    return;
  }

  const title = field.Title.toLowerCase();
  const resolved = resolveFieldValue(value);

  if (credential.ItemType === ItemTypes.Alias) {
    credential.Alias ??= {};
    applyIdentityField(credential.Alias, title, value, resolved.value);
  }
  if (credential.ItemType === ItemTypes.CreditCard) {
    credential.Creditcard ??= {};
    applyCardField(credential.Creditcard, title, value, nullIfBlank(resolved.value));
  }

  addCustomField(credential, field.Title, resolved.value, resolved.fieldType);
}

/**
 * Fill an identity slot from a section field.
 * @param alias - The alias to fill
 * @param title - The lower case field title
 * @param value - The field value
 * @param text - The field value as text
 */
function applyIdentityField(alias: ImportedAlias, title: string, value: OnePasswordFieldValue, text: string | null): void {
  if (isBlank(text)) {
    return;
  }
  if (Object.hasOwn(IDENTITY_FIELDS, title)) {
    alias[IDENTITY_FIELDS[title]] = text;
  } else if (BIRTH_DATE_TITLES.has(title)) {
    alias.BirthDate = fromUnixTimeSeconds(value.Date);
  }
}

/**
 * Fill a credit card slot from a section field. Card numbers prefer the creditCardNumber member and expiry dates
 * come from the monthYear member (YYYYMM).
 * @param card - The card to fill
 * @param title - The lower case field title
 * @param value - The field value
 * @param text - The field value as non-blank text, or null
 */
function applyCardField(card: ImportedCreditcard, title: string, value: OnePasswordFieldValue, text: string | null): void {
  if (Object.hasOwn(CARD_FIELDS, title)) {
    const slot = CARD_FIELDS[title];
    const slotValue = slot === 'Number' ? nullIfBlank(value.CreditCardNumber) ?? text : text;
    if (slotValue) {
      card[slot] = slotValue;
    }
  } else if (EXPIRY_TITLES.has(title)) {
    const monthYear = /^(\d{4})(\d{2})$/.exec(String(value.MonthYear ?? ''));
    if (monthYear) {
      card.ExpiryYear = monthYear[1];
      card.ExpiryMonth = monthYear[2];
    }
  }
}

/**
 * Resolve a field value to text and the field type it maps to.
 * @param value - The field value
 * @returns The text, null when the field is empty, and its field type
 */
function resolveFieldValue(value: OnePasswordFieldValue): { value: string | null; fieldType: FieldType } {
  for (const [member, fieldType] of TEXT_VALUE_MEMBERS) {
    const text = value[member];
    if (!isBlank(text)) {
      return { value: text, fieldType };
    }
  }

  if (value.Email?.EmailAddress !== null && value.Email?.EmailAddress !== undefined) {
    return { value: value.Email.EmailAddress, fieldType: FieldTypes.Email };
  }
  if (value.Address) {
    const address = nonBlank([value.Address.Street, value.Address.City, value.Address.State, value.Address.Zip, value.Address.Country]).join(', ');
    return { value: nullIfBlank(address), fieldType: FieldTypes.Text };
  }
  if (value.Date !== null) {
    // A "yyyy-MM-dd" string, which the Date field renders as-is.
    const date = fromUnixTimeSeconds(value.Date);
    return { value: date ? formatDateOnly(date) : null, fieldType: FieldTypes.Date };
  }
  if (value.MonthYear !== null) {
    // A month without a day is kept as "yyyy-MM" text rather than a Date field.
    const monthYear = /^(\d{4})(\d{2})$/.exec(String(value.MonthYear));
    return { value: monthYear ? `${monthYear[1]}-${monthYear[2]}` : null, fieldType: FieldTypes.Text };
  }

  return { value: null, fieldType: FieldTypes.Text };
}
