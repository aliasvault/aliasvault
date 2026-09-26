import { getProperty, readBoolean, readNumber, readObject, readObjectArray, readString, readStringArray, requireObject, type JsonObject } from '../../readers/JsonReader';

/*
 * The 1Password .1pux export format: export.attributes (version) and export.data (accounts, vaults, items).
 * Items are kept as raw JSON and deserialized one by one so a single malformed item does not abort the import.
 */

/** 1Password item categories by category id. */
export const OnePasswordCategories = { Login: '001', CreditCard: '002', SecureNote: '003', Identity: '004', Password: '005', Document: '006' } as const;

/** The vault type of the personal vault. */
export const OnePasswordPersonalVaultType = 'P';

/**
 * export.data.
 */
export type OnePassword1puxData = {
  Accounts: OnePasswordAccount[];
};

/**
 * export.attributes.
 */
export type OnePassword1puxAttributes = {
  Version: number;
  Description: string | null;
  CreatedAt: number;
};

/**
 * An account.
 */
export type OnePasswordAccount = {
  Attrs: OnePasswordAccountAttrs | null;
  Vaults: OnePasswordVault[];
};

/**
 * Account attributes.
 */
export type OnePasswordAccountAttrs = {
  AccountName: string | null;
  Name: string | null;
  Avatar: string | null;
  Email: string | null;
  Uuid: string | null;
  Domain: string | null;
};

/**
 * A vault.
 */
export type OnePasswordVault = {
  Attrs: OnePasswordVaultAttrs | null;
  /** The items as raw JSON. */
  Items: unknown[];
};

/**
 * Vault attributes.
 */
export type OnePasswordVaultAttrs = {
  Uuid: string | null;
  Desc: string | null;
  Avatar: string | null;
  Name: string | null;
  /** {@link OnePasswordPersonalVaultType} for the personal vault. */
  Type: string | null;
};

/**
 * An item.
 */
export type OnePasswordItem = {
  Uuid: string | null;
  FavIndex: number | null;
  CreatedAt: number | null;
  UpdatedAt: number | null;
  State: string | null;
  /** One of {@link OnePasswordCategories}. */
  CategoryUuid: string | null;
  Overview: OnePasswordOverview | null;
  Details: OnePasswordDetails | null;
};

/**
 * Item overview.
 */
export type OnePasswordOverview = {
  Subtitle: string | null;
  Urls: OnePasswordUrl[] | null;
  Title: string | null;
  Url: string | null;
  Ps: number | null;
  Tags: (string | null)[] | null;
};

/**
 * A URL.
 */
export type OnePasswordUrl = {
  Label: string | null;
  Url: string | null;
};

/**
 * Item details.
 */
export type OnePasswordDetails = {
  LoginFields: OnePasswordLoginField[] | null;
  NotesPlain: string | null;
  Sections: OnePasswordSection[] | null;
  PasswordHistory: OnePasswordPasswordHistory[] | null;
  DocumentAttributes: OnePasswordDocumentAttributes | null;
};

/**
 * A login field.
 */
export type OnePasswordLoginField = {
  Value: string | null;
  Id: string | null;
  Name: string | null;
  FieldType: string | null;
  /** "username" or "password". */
  Designation: string | null;
};

/**
 * A section.
 */
export type OnePasswordSection = {
  Title: string | null;
  Name: string | null;
  Fields: OnePasswordField[] | null;
};

/**
 * A section field.
 */
export type OnePasswordField = {
  Title: string | null;
  Id: string | null;
  Value: OnePasswordFieldValue | null;
  Guarded: boolean;
  Multiline: boolean;
  DontGenerate: boolean;
};

/**
 * A field value; exactly one of the members is set.
 */
export type OnePasswordFieldValue = {
  String: string | null;
  Concealed: string | null;
  Date: number | null;
  /** YYYYMM. */
  MonthYear: number | null;
  Totp: string | null;
  Url: string | null;
  CreditCardNumber: string | null;
  Menu: string | null;
  File: OnePasswordFileValue | null;
  Email: OnePasswordEmailValue | null;
  Phone: string | null;
  Address: OnePasswordAddressValue | null;
};

/**
 * A password history entry.
 */
export type OnePasswordPasswordHistory = {
  Value: string | null;
  Time: number | null;
};

/**
 * Document attributes of a Document item.
 */
export type OnePasswordDocumentAttributes = {
  FileName: string | null;
  DocumentId: string | null;
  DecryptedSize: number | null;
};

/**
 * A file field value.
 */
export type OnePasswordFileValue = {
  FileName: string | null;
  DocumentId: string | null;
  DecryptedSize: number | null;
};

/**
 * An email field value.
 */
export type OnePasswordEmailValue = {
  EmailAddress: string | null;
};

/**
 * An address field value.
 */
export type OnePasswordAddressValue = {
  Street: string | null;
  City: string | null;
  Country: string | null;
  Zip: string | null;
  State: string | null;
};

/**
 * Read export.attributes.
 * @param root - The parsed export.attributes
 * @returns The attributes
 */
export function parseOnePassword1puxAttributes(root: unknown): OnePassword1puxAttributes {
  const obj = requireObject(root, 'export.attributes');
  return { Version: readNumber(obj, 'version') ?? 0, Description: readString(obj, 'description'), CreatedAt: readNumber(obj, 'createdAt') ?? 0 };
}

/**
 * Read export.data.
 * @param root - The parsed export.data
 * @returns The data
 */
export function parseOnePassword1puxData(root: unknown): OnePassword1puxData {
  const obj = requireObject(root, 'export.data');
  return { Accounts: readObjectArray(obj, 'accounts', parseOnePasswordAccount) ?? [] };
}

/**
 * Read an account.
 * @param obj - The account JSON
 * @returns The account
 */
function parseOnePasswordAccount(obj: JsonObject): OnePasswordAccount {
  const attrs = readObject(obj, 'attrs');
  return {
    Attrs: attrs ? { AccountName: readString(attrs, 'accountName'), Name: readString(attrs, 'name'), Avatar: readString(attrs, 'avatar'), Email: readString(attrs, 'email'), Uuid: readString(attrs, 'uuid'), Domain: readString(attrs, 'domain') } : null,
    Vaults: readObjectArray(obj, 'vaults', parseOnePasswordVault) ?? [],
  };
}

/**
 * Read a vault.
 * @param obj - The vault JSON
 * @returns The vault
 */
function parseOnePasswordVault(obj: JsonObject): OnePasswordVault {
  const attrs = readObject(obj, 'attrs');
  const items = getProperty(obj, 'items');
  return {
    Attrs: attrs ? { Uuid: readString(attrs, 'uuid'), Desc: readString(attrs, 'desc'), Avatar: readString(attrs, 'avatar'), Name: readString(attrs, 'name'), Type: readString(attrs, 'type') } : null,
    Items: Array.isArray(items) ? items : [],
  };
}

/**
 * Read one item.
 * @param element - The item JSON
 * @returns The item
 */
export function parseOnePasswordItem(element: unknown): OnePasswordItem {
  const obj = requireObject(element, 'Item');
  return {
    Uuid: readString(obj, 'uuid'),
    FavIndex: readNumber(obj, 'favIndex'),
    CreatedAt: readNumber(obj, 'createdAt'),
    UpdatedAt: readNumber(obj, 'updatedAt'),
    State: readString(obj, 'state'),
    CategoryUuid: readString(obj, 'categoryUuid'),
    Overview: parseOnePasswordOverview(readObject(obj, 'overview')),
    Details: parseOnePasswordDetails(readObject(obj, 'details')),
  };
}

/**
 * Read the overview.
 * @param obj - The overview JSON, or null
 * @returns The overview, or null
 */
function parseOnePasswordOverview(obj: JsonObject | null): OnePasswordOverview | null {
  if (!obj) {
    return null;
  }
  return {
    Subtitle: readString(obj, 'subtitle'),
    Urls: readObjectArray(obj, 'urls', (url): OnePasswordUrl => ({ Label: readString(url, 'label'), Url: readString(url, 'url') })),
    Title: readString(obj, 'title'),
    Url: readString(obj, 'url'),
    Ps: readNumber(obj, 'ps'),
    Tags: readStringArray(obj, 'tags'),
  };
}

/**
 * Read the details.
 * @param obj - The details JSON, or null
 * @returns The details, or null
 */
function parseOnePasswordDetails(obj: JsonObject | null): OnePasswordDetails | null {
  if (!obj) {
    return null;
  }
  return {
    LoginFields: readObjectArray(obj, 'loginFields', (field): OnePasswordLoginField => ({ Value: readString(field, 'value'), Id: readString(field, 'id'), Name: readString(field, 'name'), FieldType: readString(field, 'fieldType'), Designation: readString(field, 'designation') })),
    NotesPlain: readString(obj, 'notesPlain'),
    Sections: readObjectArray(obj, 'sections', parseOnePasswordSection),
    PasswordHistory: readObjectArray(obj, 'passwordHistory', (entry): OnePasswordPasswordHistory => ({ Value: readString(entry, 'value'), Time: readNumber(entry, 'time') })),
    DocumentAttributes: parseOnePasswordFileValue(readObject(obj, 'documentAttributes')),
  };
}

/**
 * Read a section.
 * @param obj - The section JSON
 * @returns The section
 */
function parseOnePasswordSection(obj: JsonObject): OnePasswordSection {
  return {
    Title: readString(obj, 'title'),
    Name: readString(obj, 'name'),
    Fields: readObjectArray(obj, 'fields', parseOnePasswordField),
  };
}

/**
 * Read a section field.
 * @param obj - The field JSON
 * @returns The field
 */
function parseOnePasswordField(obj: JsonObject): OnePasswordField {
  return {
    Title: readString(obj, 'title'),
    Id: readString(obj, 'id'),
    Value: parseOnePasswordFieldValue(readObject(obj, 'value')),
    Guarded: readBoolean(obj, 'guarded') ?? false,
    Multiline: readBoolean(obj, 'multiline') ?? false,
    DontGenerate: readBoolean(obj, 'dontGenerate') ?? false,
  };
}

/**
 * Read a field value.
 * @param obj - The value JSON, or null
 * @returns The value, or null
 */
function parseOnePasswordFieldValue(obj: JsonObject | null): OnePasswordFieldValue | null {
  if (!obj) {
    return null;
  }
  const email = readObject(obj, 'email');
  const address = readObject(obj, 'address');
  return {
    String: readString(obj, 'string'),
    Concealed: readString(obj, 'concealed'),
    Date: readNumber(obj, 'date'),
    MonthYear: readNumber(obj, 'monthYear'),
    Totp: readString(obj, 'totp'),
    Url: readString(obj, 'url'),
    CreditCardNumber: readString(obj, 'creditCardNumber'),
    Menu: readString(obj, 'menu'),
    File: parseOnePasswordFileValue(readObject(obj, 'file')),
    Email: email ? { EmailAddress: readString(email, 'email_address') } : null,
    Phone: readString(obj, 'phone'),
    Address: address ? { Street: readString(address, 'street'), City: readString(address, 'city'), Country: readString(address, 'country'), Zip: readString(address, 'zip'), State: readString(address, 'state') } : null,
  };
}

/**
 * Read a file value (also the shape of documentAttributes).
 * @param obj - The file JSON, or null
 * @returns The file value, or null
 */
function parseOnePasswordFileValue(obj: JsonObject | null): OnePasswordFileValue | null {
  if (!obj) {
    return null;
  }
  return { FileName: readString(obj, 'fileName'), DocumentId: readString(obj, 'documentId'), DecryptedSize: readNumber(obj, 'decryptedSize') };
}
