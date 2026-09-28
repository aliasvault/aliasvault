import { getProperty, isJsonObject, readBoolean, readNumber, readObject, readObjectArray, readString, readStringArray, requireObject, type JsonObject } from '../../readers/JsonReader';

/*
 * The Proton Pass JSON export (data.json inside a .zip export).
 */

/** Proton Pass item states; older exports leave the state out, which means active. */
export const ProtonPassItemStates = { Active: 1, Trashed: 2 } as const;

/**
 * The export root.
 */
export type ProtonPassJsonExport = {
  UserId: string | null;
  Version: string | null;
  Encrypted: boolean;
  /** The vaults, keyed by vault id. */
  Vaults: Map<string, ProtonPassVault>;
};

/**
 * A vault.
 */
export type ProtonPassVault = {
  Name: string | null;
  Description: string | null;
  Display: ProtonPassDisplay | null;
  /** The items as raw JSON. */
  Items: unknown[];
};

/**
 * Vault display settings.
 */
export type ProtonPassDisplay = {
  Color: number;
  Icon: number;
};

/**
 * An item envelope.
 */
export type ProtonPassItem = {
  ItemId: string | null;
  ShareId: string | null;
  Data: ProtonPassItemData | null;
  /** One of {@link ProtonPassItemStates}. */
  State: number | null;
  /** The generated email of an alias item. */
  AliasEmail: string | null;
  ContentFormatVersion: number | null;
  CreateTime: number | null;
  ModifyTime: number | null;
  Pinned: boolean;
  ShareCount: number;
  Files: ProtonPassFile[] | null;
};

/**
 * Item data.
 */
export type ProtonPassItemData = {
  Metadata: ProtonPassMetadata | null;
  ExtraFields: ProtonPassExtraField[] | null;
  /** login, note, alias, creditCard or identity. */
  Type: string | null;
  Content: ProtonPassContent | null;
};

/**
 * Item metadata.
 */
export type ProtonPassMetadata = {
  Name: string | null;
  Note: string | null;
  ItemUuid: string | null;
};

/**
 * Type-specific content, one flat shape for every item type.
 */
export type ProtonPassContent = {
  ItemUsername: string | null;
  ItemEmail: string | null;
  Password: string | null;
  Urls: (string | null)[] | null;
  TotpUri: string | null;
  Passkeys: ProtonPassPasskey[] | null;
  CardholderName: string | null;
  Number: string | null;
  VerificationNumber: string | null;
  Pin: string | null;
  ExpirationDate: string | null;
  CardType: number | null;
  FirstName: string | null;
  LastName: string | null;
  FullName: string | null;
  Email: string | null;
};

/**
 * A passkey.
 */
export type ProtonPassPasskey = {
  CredentialId: string | null;
  RpId: string | null;
  RpName: string | null;
  UserName: string | null;
};

/**
 * A custom field.
 */
export type ProtonPassExtraField = {
  FieldName: string | null;
  /** text, hidden, totp or date. */
  Type: string | null;
  Data: ProtonPassExtraFieldData | null;
};

/**
 * Custom field data.
 */
export type ProtonPassExtraFieldData = {
  Content: string | null;
};

/**
 * A file attached to an item.
 */
export type ProtonPassFile = {
  FileId: string | null;
  Name: string | null;
  MimeType: string | null;
  Size: number | null;
};

/**
 * Read the export root.
 * @param root - The parsed data.json
 * @returns The export
 */
export function parseProtonPassJsonExport(root: unknown): ProtonPassJsonExport {
  const obj = requireObject(root, 'data.json');
  const vaults = new Map<string, ProtonPassVault>();
  const vaultsObj = readObject(obj, 'vaults');
  if (vaultsObj) {
    for (const [vaultId, vault] of Object.entries(vaultsObj)) {
      vaults.set(vaultId, parseProtonPassVault(requireObject(vault, `Vault '${vaultId}'`)));
    }
  }
  return {
    UserId: readString(obj, 'userId'),
    Version: readString(obj, 'version'),
    Encrypted: readBoolean(obj, 'encrypted') ?? false,
    Vaults: vaults,
  };
}

/**
 * Read a vault.
 * @param obj - The vault JSON
 * @returns The vault
 */
function parseProtonPassVault(obj: JsonObject): ProtonPassVault {
  const display = readObject(obj, 'display');
  const items = getProperty(obj, 'items');
  return {
    Name: readString(obj, 'name'),
    Description: readString(obj, 'description'),
    Display: display ? { Color: readNumber(display, 'color') ?? 0, Icon: readNumber(display, 'icon') ?? 0 } : null,
    Items: Array.isArray(items) ? items : [],
  };
}

/**
 * Read one item envelope.
 * @param element - The item JSON
 * @returns The item
 */
export function parseProtonPassItem(element: unknown): ProtonPassItem {
  const obj = requireObject(element, 'Item');
  return {
    ItemId: readString(obj, 'itemId'),
    ShareId: readString(obj, 'shareId'),
    Data: parseProtonPassItemData(readObject(obj, 'data')),
    State: readNumber(obj, 'state'),
    AliasEmail: readString(obj, 'aliasEmail'),
    ContentFormatVersion: readNumber(obj, 'contentFormatVersion'),
    CreateTime: readNumber(obj, 'createTime'),
    ModifyTime: readNumber(obj, 'modifyTime'),
    Pinned: readBoolean(obj, 'pinned') ?? false,
    ShareCount: readNumber(obj, 'shareCount') ?? 0,
    Files: readObjectArray(obj, 'files', (file): ProtonPassFile => ({ FileId: readString(file, 'fileID'), Name: readString(file, 'name'), MimeType: readString(file, 'mimeType'), Size: readNumber(file, 'size') })),
  };
}

/**
 * Read item data.
 * @param obj - The data JSON, or null
 * @returns The data, or null
 */
function parseProtonPassItemData(obj: JsonObject | null): ProtonPassItemData | null {
  if (!obj) {
    return null;
  }
  const metadata = readObject(obj, 'metadata');
  return {
    Metadata: metadata ? { Name: readString(metadata, 'name'), Note: readString(metadata, 'note'), ItemUuid: readString(metadata, 'itemUuid') } : null,
    ExtraFields: readObjectArray(obj, 'extraFields', parseProtonPassExtraField),
    Type: readString(obj, 'type'),
    Content: parseProtonPassContent(readObject(obj, 'content')),
  };
}

/**
 * Read a custom field.
 * @param obj - The field JSON
 * @returns The field
 */
function parseProtonPassExtraField(obj: JsonObject): ProtonPassExtraField {
  const data = readObject(obj, 'data');
  return {
    FieldName: readString(obj, 'fieldName'),
    Type: readString(obj, 'type'),
    Data: data ? { Content: readString(data, 'content') } : null,
  };
}

/**
 * Read type-specific content.
 * @param obj - The content JSON, or null
 * @returns The content, or null
 */
function parseProtonPassContent(obj: JsonObject | null): ProtonPassContent | null {
  if (!obj) {
    return null;
  }
  
  const passkeys = getProperty(obj, 'passkeys');

  return {
    ItemUsername: readString(obj, 'itemUsername'),
    ItemEmail: readString(obj, 'itemEmail'),
    Password: readString(obj, 'password'),
    Urls: readStringArray(obj, 'urls'),
    TotpUri: readString(obj, 'totpUri'),
    Passkeys: Array.isArray(passkeys)
      ? passkeys.filter(isJsonObject).map((passkey): ProtonPassPasskey => ({ CredentialId: readString(passkey, 'credentialId'), RpId: readString(passkey, 'rpId'), RpName: readString(passkey, 'rpName'), UserName: readString(passkey, 'userName') }))
      : null,
    CardholderName: readString(obj, 'cardholderName'),
    Number: readString(obj, 'number'),
    VerificationNumber: readString(obj, 'verificationNumber'),
    Pin: readString(obj, 'pin'),
    ExpirationDate: readString(obj, 'expirationDate'),
    CardType: readNumber(obj, 'cardType'),
    FirstName: readString(obj, 'firstName'),
    LastName: readString(obj, 'lastName'),
    FullName: readString(obj, 'fullName'),
    Email: readString(obj, 'email'),
  };
}
