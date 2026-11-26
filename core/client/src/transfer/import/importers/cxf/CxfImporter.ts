import { FieldTypes, ItemTypes, type FieldType } from '@aliasvault/models/vault';

import { base64UrlToBytes } from '../../../../utilities/Base64';
import { isBlank } from '../../../shared/StringUtils';
import { ImportException, ImportStage } from '../../models/ImportException';
import { addCustomField, buildItemFailure } from '../../readers/ArchiveImport';
import { isJsonObject, type JsonObject } from '../../readers/JsonReader';
import { buildPasskey, rustPasskeyKeys, type PasskeyKeyConverter } from '../../readers/PasskeyImport';

import type { ImportedCredential } from '../../models/ImportedCredential';
import type { ImportedPasskey } from '../../models/ImportedPasskey';
import type { ImportFileResult } from '../../models/ImportFileResult';

/**
 * What a CXF document holds, by credential type, for the import preview.
 */
export type CxfImportSummary = {
  items: number;
  passwords: number;
  passkeys: number;
  totpCodes: number;
  notes: number;
  creditCards: number;
  /** Entries of a kind AliasVault has no equivalent item type for (e.g. Wi-Fi, SSH key, address), whose data is saved as custom fields on the item. */
  savedAsCustomFields: number;
  /** Credentials left out: item references, file placeholders and passkeys with an unusable key. */
  unsupported: number;
  failedItems: number;
};

/**
 * The credentials of a CXF document, the items that could not be read and the counts for the preview.
 */
export type CxfImportResult = ImportFileResult & { Summary: CxfImportSummary };

/**
 * An EditableField: a typed value with an optional label.
 */
type EditableField = {
  FieldType: string;
  Value: string;
  Label: string | null;
};

/**
 * Error for an item that cannot be imported.
 */
class CxfItemError extends Error {}

/** CXF credential types that carry nothing the vault can hold. */
const UNSUPPORTED_TYPES = new Set(['item-reference', 'file']);

/** CXF defined credential types that have no direct AliasVault equivalent, with the label their members get as custom fields. */
const CUSTOM_FIELD_TYPES: ReadonlyMap<string, string> = new Map([
  ['address', 'Address'],
  ['api-key', 'API key'],
  ['ssh-key', 'SSH key'],
  ['wifi', 'Wi-Fi'],
  ['identity-document', 'Identity document'],
  ['passport', 'Passport'],
  ['drivers-license', "Driver's license"],
  ['generated-password', 'Generated password'],
]);

/** Members of the credential types kept as custom fields that are secrets, so they become hidden fields. */
const SECRET_MEMBERS = new Set(['key', 'privateKey', 'passphrase', 'password', 'pin', 'verificationNumber', 'number']);

/**
 * Import a FIDO Credential Exchange Format (CXF 1.0) document into AliasVault structure.
 * @param text - The document as JSON text
 * @param keys - Converts passkey keys, the Rust core by default
 * @returns The credentials, the failed items and the summary
 * @throws {ImportException} When the text is not a CXF document.
 */
export async function importCxf(text: string, keys: PasskeyKeyConverter = rustPasskeyKeys): Promise<CxfImportResult> {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (error) {
    throw new ImportException(ImportStage.Parse, 'The credential exchange document is not valid JSON', error);
  }
  const accounts = isJsonObject(root) ? arrayOf(root, 'accounts') ?? (arrayOf(root, 'items') ? [root] : null) : null;
  if (!accounts) {
    throw new ImportException(ImportStage.Parse, 'The credential exchange document has neither accounts nor items');
  }

  const result: CxfImportResult = { Credentials: [], FailedItems: [], Summary: { items: 0, passwords: 0, passkeys: 0, totpCodes: 0, notes: 0, creditCards: 0, savedAsCustomFields: 0, unsupported: 0, failedItems: 0 } };
  let index = 0;
  for (const account of accounts.filter(isJsonObject)) {
    const folderPaths = collectFolderPaths(arrayOf(account, 'collections') ?? []);
    for (const element of arrayOf(account, 'items') ?? []) {
      try {
        result.Credentials.push(await convertItem(element, folderPaths, keys, result.Summary));
      } catch (error) {
        const title = isJsonObject(element) ? textOf(element, 'title') : null;
        result.FailedItems.push(error instanceof CxfItemError ? { Index: index, ItemTitle: title, ExceptionType: 'CredentialExchangeItemError', Message: `Failed to parse item: ${error.message}` } : buildItemFailure(index, title, error));
      }
      index++;
    }
  }
  result.Summary.items = result.Credentials.length;
  result.Summary.failedItems = result.FailedItems.length;
  return result;
}

/**
 * Convert one CXF Item to a credential, adding what it holds to the summary.
 * @param element - The item JSON
 * @param folderPaths - Item ids to folder paths
 * @param keys - Converts passkey keys
 * @param summary - The summary to add to
 * @returns The credential
 * @throws {CxfItemError} When the item has the wrong shape or its only credential is a passkey that cannot be stored.
 */
async function convertItem(element: unknown, folderPaths: Map<string, string>, keys: PasskeyKeyConverter, summary: CxfImportSummary): Promise<ImportedCredential> {
  if (!isJsonObject(element)) {
    throw new CxfItemError('The item is not an object');
  }
  const credentials = arrayOf(element, 'credentials') ?? [];
  const wrongShape = credentials.findIndex(credential => !isJsonObject(credential));
  if (wrongShape >= 0) {
    throw new CxfItemError(`Credential ${wrongShape} is not an object`);
  }

  const scope = objectOf(element, 'scope');
  const id = textOf(element, 'id');
  // Android apps join the URLs as their bare package name, which is how the vault stores an app.
  const androidApps = (scope ? arrayOf(scope, 'androidApps') ?? [] : []).map(app => (isJsonObject(app) ? textOf(app, 'bundleId') : null)).filter(bundleId => bundleId !== null);
  const urls = [...strings(scope ? arrayOf(scope, 'urls') : null), ...androidApps];
  const tags = strings(arrayOf(element, 'tags'));
  const credential: ImportedCredential = {
    ServiceName: textOf(element, 'title') ?? '',
    ServiceUrls: urls.length > 0 ? urls : null,
    CreatedAt: timestamp(element['creationAt']),
    UpdatedAt: timestamp(element['modifiedAt']),
    FolderPath: id === null ? null : folderPaths.get(id) ?? null,
    Tags: tags.length > 0 ? tags : null,
  };
  const counts = { savedAsCustomFields: 0, unsupported: 0 };
  const notes: string[] = [];
  let passkeyUsername: string | null = null;
  let firstName: string | null = null;
  let lastName: string | null = null;

  for (const raw of credentials as JsonObject[]) {
    const type = textOf(raw, 'type') ?? '';
    switch (type) {
      case 'basic-auth':
        credential.Username ??= valueOf(raw, 'username');
        credential.Password ??= valueOf(raw, 'password');
        break;
      case 'passkey': {
        let passkey: ImportedPasskey;
        try {
          passkey = await convertPasskey(raw, keys);
        } catch {
          // Skip a passkey that cannot be stored.
          if (credentials.length > 1) {
            counts.unsupported++;
            break;
          }
          throw new CxfItemError('The passkey cannot be stored: it needs rpId, credentialId and a PKCS#8 P-256 or RSA key');
        }
        credential.ServiceUrls ??= [`https://${passkey.RpId}`];
        credential.Passkeys = [...(credential.Passkeys ?? []), passkey];
        passkeyUsername ??= textOf(raw, 'username');
        break;
      }
      case 'totp':
        credential.TwoFactorCodes = [...(credential.TwoFactorCodes ?? []), { Secret: totpUri(raw) }];
        break;
      case 'note': {
        const content = valueOf(raw, 'content');
        if (content !== null) {
          notes.push(content);
        }
        break;
      }
      case 'credit-card':
        credential.ItemType = ItemTypes.CreditCard;
        credential.Creditcard = convertCard(raw);
        break;
      case 'person-name':
        firstName = joinNonBlank([valueOf(raw, 'given'), valueOf(raw, 'given2')]) ?? firstName;
        lastName = joinNonBlank([valueOf(raw, 'surnamePrefix'), valueOf(raw, 'surname'), valueOf(raw, 'surname2')]) ?? lastName;
        break;
      case 'custom-fields':
        for (const field of (arrayOf(raw, 'fields') ?? []).map(editableField)) {
          if (field) {
            addCustomField(credential, field.Label ?? textOf(raw, 'label') ?? 'Field', field.Value, fieldTypeOf(field.FieldType));
          }
        }
        break;
      default:
        if (UNSUPPORTED_TYPES.has(type)) {
          counts.unsupported++;
        } else {
          counts.savedAsCustomFields++;
          addCredentialAsCustomFields(credential, type, raw);
        }
    }
  }

  if (!credential.Username && passkeyUsername) {
    credential.Username = passkeyUsername;
  }
  if (firstName !== null || lastName !== null) {
    credential.Alias = { FirstName: firstName, LastName: lastName };
  }
  const subtitle = textOf(element, 'subtitle');
  if (subtitle !== (credential.Username ?? null)) {
    addCustomField(credential, 'Subtitle', subtitle);
  }
  if (notes.length > 0) {
    credential.Notes = notes.join('\n\n');
  }
  if (!credential.ItemType && !credential.Username && !credential.Password && !credential.Passkeys && !credential.TwoFactorCodes && credential.Notes) {
    credential.ItemType = ItemTypes.Note;
  }

  summary.passwords += credential.Password ? 1 : 0;
  summary.passkeys += credential.Passkeys?.length ?? 0;
  summary.totpCodes += credential.TwoFactorCodes?.length ?? 0;
  summary.notes += credential.Notes ? 1 : 0;
  summary.creditCards += credential.ItemType === ItemTypes.CreditCard ? 1 : 0;
  summary.savedAsCustomFields += counts.savedAsCustomFields;
  summary.unsupported += counts.unsupported;
  return credential;
}

/**
 * Convert a passkey credential to AliasVault expected format.
 * @param raw - The credential
 * @param keys - Converts the key
 * @returns The passkey
 */
async function convertPasskey(raw: JsonObject, keys: PasskeyKeyConverter): Promise<ImportedPasskey> {
  const credentialId = textOf(raw, 'credentialId');
  const key = textOf(raw, 'key');
  if (isBlank(credentialId) || isBlank(key)) {
    throw new ImportException(ImportStage.Parse, 'A passkey needs rpId, credentialId and key');
  }
  const userHandle = textOf(raw, 'userHandle');
  const extensions = objectOf(raw, 'fido2Extensions');
  return buildPasskey({
    RpId: textOf(raw, 'rpId'),
    CredentialId: base64UrlToBytes(credentialId),
    UserHandle: userHandle ? base64UrlToBytes(userHandle) : null,
    Keys: await keys.fromPkcs8(base64UrlToBytes(key)),
    PrfSecret: extensions ? prfSecret(extensions) : null,
    DisplayNames: [textOf(raw, 'userDisplayName'), textOf(raw, 'username')],
    AdditionalData: extensions ? additionalData(extensions) : null,
  });
}

/**
 * The PRF secret of the hmac-secret credentials.
 * @param extensions - The fido2Extensions object
 * @returns The secret, or null when absent or of an unknown algorithm
 */
function prfSecret(extensions: JsonObject): Uint8Array | null {
  const hmac = objectOf(extensions, 'hmacCredentials');
  if (!hmac || (textOf(hmac, 'algorithm') ?? 'hmac-sha256') !== 'hmac-sha256') {
    return null;
  }
  const secret = textOf(hmac, 'credWithUV') ?? textOf(hmac, 'credWithoutUV');
  try {
    return secret === null ? null : base64UrlToBytes(secret);
  } catch {
    return null;
  }
}

/**
 * The passkey extension data AliasVault does not support natively (credBlob, largeBlob, payments). It is stored as-is in the passkey's
 * AdditionalData, for possible future use and so a future export can pass it on.
 * @param extensions - The fido2Extensions object
 * @returns `{ "fido2Extensions": ... }` as UTF-8 JSON, or null when there is nothing to keep
 */
function additionalData(extensions: JsonObject): Uint8Array | null {
  const kept = Object.fromEntries(Object.entries(extensions).filter(([name]) => name !== 'hmacCredentials'));
  return Object.keys(kept).length > 0 ? new TextEncoder().encode(JSON.stringify({ fido2Extensions: kept })) : null;
}

/**
 * A TOTP credential as the otpauth URI the item converter reads.
 * @param raw - The credential
 * @returns The URI
 */
function totpUri(raw: JsonObject): string {
  const issuer = textOf(raw, 'issuer') || null;
  const username = textOf(raw, 'username') || null;
  const label = issuer && username ? `${issuer}:${username}` : issuer ?? username ?? '';
  const params = new URLSearchParams({ secret: (textOf(raw, 'secret') ?? '').replace(/\s+/g, '') });
  if (issuer) {
    params.set('issuer', issuer);
  }
  const algorithm = textOf(raw, 'algorithm');
  if (algorithm) {
    params.set('algorithm', algorithm.toUpperCase());
  }
  for (const name of ['digits', 'period']) {
    const value = raw[name];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      params.set(name, String(Math.trunc(value)));
    }
  }
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

/**
 * The card fields of a credit-card credential; the `YYYY-MM` expiry is split in year and month.
 * @param raw - The credential
 * @returns The card
 */
function convertCard(raw: JsonObject): NonNullable<ImportedCredential['Creditcard']> {
  const expiry = /^(\d{4})-(\d{1,2})/.exec(valueOf(raw, 'expiryDate') ?? '');
  return {
    Number: valueOf(raw, 'number'),
    CardholderName: valueOf(raw, 'fullName'),
    Cvv: valueOf(raw, 'verificationNumber'),
    Pin: valueOf(raw, 'pin'),
    ExpiryYear: expiry ? expiry[1] : null,
    ExpiryMonth: expiry ? expiry[2].padStart(2, '0') : null,
  };
}

/**
 * Keep every member of a credential the vault has no type for as a custom field, labelled after the credential.
 * Members keep their document order.
 * @param credential - The credential to fill
 * @param type - The CXF credential type
 * @param raw - The CXF credential
 */
function addCredentialAsCustomFields(credential: ImportedCredential, type: string, raw: JsonObject): void {
  const prefix = CUSTOM_FIELD_TYPES.get(type) ?? type;
  for (const [member, value] of Object.entries(raw)) {
    if (member === 'type') {
      continue;
    }
    const isSecret = SECRET_MEMBERS.has(member);
    const field = editableField(value);
    if (field) {
      addCustomField(credential, `${prefix}: ${field.Label ?? humanize(member)}`, field.Value, isSecret ? FieldTypes.Hidden : fieldTypeOf(field.FieldType));
    } else {
      addCustomField(credential, `${prefix}: ${humanize(member)}`, scalarText(value), isSecret ? FieldTypes.Hidden : FieldTypes.Text);
    }
  }
}

/**
 * The vault field type of a CXF field type.
 * @param fieldType - The CXF field type
 * @returns The vault field type
 */
function fieldTypeOf(fieldType: string): FieldType {
  switch (fieldType) {
    case 'concealed-string':
      return FieldTypes.Hidden;
    case 'email':
      return FieldTypes.Email;
    case 'number':
      return FieldTypes.Number;
    case 'date':
      return FieldTypes.Date;
    default:
      return FieldTypes.Text;
  }
}

/**
 * The folder path of every item id, from the collection tree: a title is a folder name, nesting a path.
 * @param collections - The account's collections
 * @returns Item ids to folder paths
 */
function collectFolderPaths(collections: unknown[]): Map<string, string> {
  const paths = new Map<string, string>();
  /**
   * Record the path of a collection's items, then descend into its sub-collections.
   * @param collection - The collection
   * @param parentPath - The path of its parent, or null at the top
   */
  const walk = (collection: unknown, parentPath: string | null): void => {
    if (!isJsonObject(collection)) {
      return;
    }
    const name = (textOf(collection, 'title') ?? '').trim().replace(/\//g, '-');
    const path = name.length === 0 ? parentPath : parentPath ? `${parentPath}/${name}` : name;
    if (path) {
      for (const linked of arrayOf(collection, 'items') ?? []) {
        const id = isJsonObject(linked) ? textOf(linked, 'item') : null;
        if (id !== null && !paths.has(id)) {
          paths.set(id, path);
        }
      }
    }
    (arrayOf(collection, 'subCollections') ?? []).forEach(child => walk(child, path));
  };
  collections.forEach(collection => walk(collection, null));
  return paths;
}

/**
 * A timestamp member as a date.
 * @param value - Unix seconds
 * @returns The date, or null for a missing, non-positive (an unknown date) or out of range value
 */
function timestamp(value: unknown): Date | null {
  const seconds = typeof value === 'number' ? Math.trunc(value) : 0;
  // 253402300799 is the last second of year 9999 (max date we can store).
  return seconds > 0 && seconds <= 253_402_300_799 ? new Date(seconds * 1000) : null;
}

/**
 * An EditableField object. A value that is not a string (some exporters write booleans and numbers) becomes its text.
 * @param field - The field JSON
 * @returns The field, or null when the value is not an object
 */
function editableField(field: unknown): EditableField | null {
  return isJsonObject(field) ? { FieldType: textOf(field, 'fieldType') ?? 'string', Value: scalarText(field['value']) ?? '', Label: textOf(field, 'label') } : null;
}

/**
 * The value of an EditableField member.
 * @param credential - The CXF credential
 * @param name - The member name
 * @returns The value, or null when absent or blank
 */
function valueOf(credential: JsonObject, name: string): string | null {
  const value = editableField(credential[name])?.Value;
  return isBlank(value) ? null : value;
}

/**
 * A scalar as the text a custom field holds.
 * @param value - The JSON value
 * @returns The text, or null for null, arrays and objects
 */
function scalarText(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : null;
}

/**
 * A string member, read by its exact name.
 * @param obj - The object
 * @param name - The member name
 * @returns The string, or null when absent or not a string
 */
function textOf(obj: JsonObject, name: string): string | null {
  const value = obj[name];
  return typeof value === 'string' ? value : null;
}

/**
 * An object member.
 * @param obj - The object
 * @param name - The member name
 * @returns The object, or null when absent or not an object
 */
function objectOf(obj: JsonObject, name: string): JsonObject | null {
  const value = obj[name];
  return isJsonObject(value) ? value : null;
}

/**
 * An array member.
 * @param obj - The object
 * @param name - The member name
 * @returns The array, or null when absent or not an array
 */
function arrayOf(obj: JsonObject, name: string): unknown[] | null {
  const value = obj[name];
  return Array.isArray(value) ? value : null;
}

/**
 * The non-empty strings of an array.
 * @param values - The array, or null
 * @returns The strings
 */
function strings(values: unknown[] | null): string[] {
  return (values ?? []).filter((value): value is string => typeof value === 'string' && value.length > 0);
}

/**
 * Join the non-blank parts with spaces.
 * @param parts - The parts
 * @returns The joined text, or null when nothing was given
 */
function joinNonBlank(parts: (string | null)[]): string | null {
  const joined = parts.filter(part => part !== null).join(' ');
  return joined.length > 0 ? joined : null;
}

/**
 * A camelCase member name as a label: `issuingCountry` becomes `Issuing country`.
 * @param member - The member name
 * @returns The label
 */
function humanize(member: string): string {
  const spaced = member.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
