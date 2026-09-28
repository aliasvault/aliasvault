import { parseDateTime } from '../../../shared/DateTimeUtils';
import { getProperty, readBoolean, readNumber, readObject, readObjectArray, readString, readStringArray, requireObject, type JsonObject } from '../../readers/JsonReader';

/*
 * The Bitwarden JSON export (data.json inside a .zip export).
 */

/** Bitwarden item types. */
export const BitwardenItemTypes = { Login: 1, SecureNote: 2, Card: 3, Identity: 4 } as const;

/** Bitwarden custom field types. */
export const BitwardenFieldTypes = { Text: 0, Hidden: 1, Boolean: 2, Linked: 3 } as const;

/**
 * The export root.
 */
export type BitwardenJsonExport = {
  Encrypted: boolean;
  Folders: BitwardenFolder[];
  /** The items as raw JSON. */
  Items: unknown[];
  /** Collections (organization exports). */
  Collections: BitwardenCollection[] | null;
};

/**
 * A folder.
 */
export type BitwardenFolder = {
  Id: string | null;
  Name: string | null;
};

/**
 * A collection.
 */
export type BitwardenCollection = {
  Id: string | null;
  Name: string | null;
};

/**
 * An item.
 */
export type BitwardenItem = {
  Id: string | null;
  OrganizationId: string | null;
  FolderId: string | null;
  /** One of {@link BitwardenItemTypes}. */
  Type: number;
  Reprompt: number;
  Name: string | null;
  Notes: string | null;
  Favorite: boolean;
  RevisionDate: Date | null;
  PasswordHistory: BitwardenPasswordHistory[] | null;
  Fields: BitwardenField[] | null;
  Login: BitwardenLogin | null;
  SecureNote: BitwardenSecureNote | null;
  Card: BitwardenCard | null;
  Identity: BitwardenIdentity | null;
  CollectionIds: (string | null)[] | null;
};

/**
 * A password history entry.
 */
export type BitwardenPasswordHistory = {
  LastUsedDate: Date | null;
  Password: string | null;
};

/**
 * A custom field.
 */
export type BitwardenField = {
  Name: string | null;
  Value: string | null;
  LinkedId: number | null;
  /** One of {@link BitwardenFieldTypes}. */
  Type: number;
};

/**
 * Login data.
 */
export type BitwardenLogin = {
  Uris: BitwardenUri[] | null;
  Username: string | null;
  Password: string | null;
  Totp: string | null;
};

/**
 * A login URI.
 */
export type BitwardenUri = {
  Match: number | null;
  Uri: string | null;
};

/**
 * Secure note data.
 */
export type BitwardenSecureNote = {
  Type: number;
};

/**
 * Card data.
 */
export type BitwardenCard = {
  CardholderName: string | null;
  Brand: string | null;
  Number: string | null;
  ExpMonth: string | null;
  ExpYear: string | null;
  Code: string | null;
};

/**
 * Identity data.
 */
export type BitwardenIdentity = {
  Title: string | null;
  FirstName: string | null;
  MiddleName: string | null;
  LastName: string | null;
  Address1: string | null;
  Address2: string | null;
  Address3: string | null;
  City: string | null;
  State: string | null;
  PostalCode: string | null;
  Country: string | null;
  Company: string | null;
  Email: string | null;
  Phone: string | null;
  Ssn: string | null;
  Username: string | null;
  PassportNumber: string | null;
  LicenseNumber: string | null;
};

/**
 * Read the export root.
 * @param root - The parsed data.json
 * @returns The export
 */
export function parseBitwardenJsonExport(root: unknown): BitwardenJsonExport {
  const obj = requireObject(root, 'data.json');
  return {
    Encrypted: readBoolean(obj, 'encrypted') ?? false,
    Folders: readObjectArray(obj, 'folders', parseBitwardenFolder) ?? [],
    Items: readItemsRaw(obj),
    Collections: readObjectArray(obj, 'collections', (element): BitwardenCollection => ({ Id: readString(element, 'id'), Name: readString(element, 'name') })),
  };
}

/**
 * Read the raw item elements, left unparsed so each item can fail on its own.
 * @param obj - The export root
 * @returns The items, empty when absent
 */
function readItemsRaw(obj: JsonObject): unknown[] {
  const value = getProperty(obj, 'items');
  return Array.isArray(value) ? value : [];
}

/**
 * Read a folder.
 * @param element - The folder JSON
 * @returns The folder
 */
function parseBitwardenFolder(element: JsonObject): BitwardenFolder {
  return { Id: readString(element, 'id'), Name: readString(element, 'name') };
}

/**
 * Read one item.
 * @param element - The item JSON
 * @returns The item
 */
export function parseBitwardenItem(element: unknown): BitwardenItem {
  const obj = requireObject(element, 'Item');
  return {
    Id: readString(obj, 'id'),
    OrganizationId: readString(obj, 'organizationId'),
    FolderId: readString(obj, 'folderId'),
    Type: readNumber(obj, 'type') ?? 0,
    Reprompt: readNumber(obj, 'reprompt') ?? 0,
    Name: readString(obj, 'name'),
    Notes: readString(obj, 'notes'),
    Favorite: readBoolean(obj, 'favorite') ?? false,
    RevisionDate: parseDateTime(readString(obj, 'revisionDate')),
    PasswordHistory: readObjectArray(obj, 'passwordHistory', (entry): BitwardenPasswordHistory => ({ LastUsedDate: parseDateTime(readString(entry, 'lastUsedDate')), Password: readString(entry, 'password') })),
    Fields: readObjectArray(obj, 'fields', (field): BitwardenField => ({ Name: readString(field, 'name'), Value: readString(field, 'value'), LinkedId: readNumber(field, 'linkedId'), Type: readNumber(field, 'type') ?? 0 })),
    Login: parseBitwardenLogin(readObject(obj, 'login')),
    SecureNote: parseBitwardenSecureNote(readObject(obj, 'secureNote')),
    Card: parseBitwardenCard(readObject(obj, 'card')),
    Identity: parseBitwardenIdentity(readObject(obj, 'identity')),
    CollectionIds: readStringArray(obj, 'collectionIds'),
  };
}

/**
 * Read login data.
 * @param obj - The login JSON, or null
 * @returns The login, or null
 */
function parseBitwardenLogin(obj: JsonObject | null): BitwardenLogin | null {
  if (!obj) {
    return null;
  }
  return {
    Uris: readObjectArray(obj, 'uris', (uri): BitwardenUri => ({ Match: readNumber(uri, 'match'), Uri: readString(uri, 'uri') })),
    Username: readString(obj, 'username'),
    Password: readString(obj, 'password'),
    Totp: readString(obj, 'totp'),
  };
}

/**
 * Read secure note data.
 * @param obj - The secure note JSON, or null
 * @returns The secure note, or null
 */
function parseBitwardenSecureNote(obj: JsonObject | null): BitwardenSecureNote | null {
  return obj ? { Type: readNumber(obj, 'type') ?? 0 } : null;
}

/**
 * Read card data.
 * @param obj - The card JSON, or null
 * @returns The card, or null
 */
function parseBitwardenCard(obj: JsonObject | null): BitwardenCard | null {
  if (!obj) {
    return null;
  }
  return {
    CardholderName: readString(obj, 'cardholderName'),
    Brand: readString(obj, 'brand'),
    Number: readString(obj, 'number'),
    ExpMonth: readString(obj, 'expMonth'),
    ExpYear: readString(obj, 'expYear'),
    Code: readString(obj, 'code'),
  };
}

/**
 * Read identity data.
 * @param obj - The identity JSON, or null
 * @returns The identity, or null
 */
function parseBitwardenIdentity(obj: JsonObject | null): BitwardenIdentity | null {
  if (!obj) {
    return null;
  }
  return {
    Title: readString(obj, 'title'),
    FirstName: readString(obj, 'firstName'),
    MiddleName: readString(obj, 'middleName'),
    LastName: readString(obj, 'lastName'),
    Address1: readString(obj, 'address1'),
    Address2: readString(obj, 'address2'),
    Address3: readString(obj, 'address3'),
    City: readString(obj, 'city'),
    State: readString(obj, 'state'),
    PostalCode: readString(obj, 'postalCode'),
    Country: readString(obj, 'country'),
    Company: readString(obj, 'company'),
    Email: readString(obj, 'email'),
    Phone: readString(obj, 'phone'),
    Ssn: readString(obj, 'ssn'),
    Username: readString(obj, 'username'),
    PassportNumber: readString(obj, 'passportNumber'),
    LicenseNumber: readString(obj, 'licenseNumber'),
  };
}
