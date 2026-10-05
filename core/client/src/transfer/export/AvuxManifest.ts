/*
 * The manifest.json of an .avux (AliasVault Unencrypted eXport) archive. Property names are the JSON wire names
 * (camelCase); dates are ISO 8601 strings. Readers match property names case-insensitively.
 */

/**
 * A field value in an item.
 */
export type AvuxFieldValue = {
  id: string;
  /** The system field key (e.g. "login.username"), null for custom fields. */
  fieldKey: string | null;
  /** The custom field definition id, null for system fields. */
  fieldDefinitionId: string | null;
  value: string | null;
  weight: number;
};

/**
 * A previous value of a field in an item.
 */
export type AvuxFieldHistory = {
  id: string;
  /** The system field key, null for custom fields. */
  fieldKey: string | null;
  /** The custom field definition id, null for system fields. */
  fieldDefinitionId: string | null;
  valueSnapshot: string;
  changedAt: string;
};

/**
 * An attachment in an item.
 */
export type AvuxAttachment = {
  id: string;
  filename: string;
  /** The relative path in the .avux archive. */
  relativePath: string;
};

/**
 * A TOTP code in an item.
 */
export type AvuxTotpCode = {
  id: string;
  name: string;
  secretKey: string;
  /** HMAC algorithm: SHA1, SHA256 or SHA512. */
  algorithm: string;
  digits: number;
  period: number;
};

/**
 * A passkey in an item.
 */
export type AvuxPasskey = {
  /** The passkey id; the WebAuthn credential id is derived from it at runtime unless credentialId is set. */
  id: string;
  /** The WebAuthn credential id (base64-encoded), null when it is derived from id. */
  credentialId: string | null;
  rpId: string;
  /** The user handle (base64-encoded). */
  userHandle: string | null;
  publicKey: string;
  privateKey: string;
  /** The PRF key (base64-encoded). */
  prfKey: string | null;
  displayName: string;
  additionalData: string | null;
};

/**
 * An item in the .avux export.
 */
export type AvuxItem = {
  id: string;
  name: string | null;
  /** Login, Alias, CreditCard or Note. */
  itemType: string;
  createdAt: string;
  updatedAt: string;
  folderId: string | null;
  logoId: string | null;
  /** When the item was archived, null when it is not. */
  archivedAt: string | null;
  fieldValues: AvuxFieldValue[];
  fieldHistories: AvuxFieldHistory[];
  attachments: AvuxAttachment[];
  totpCodes: AvuxTotpCode[];
  passkeys: AvuxPasskey[];
};

/**
 * A folder.
 */
export type AvuxFolder = {
  id: string;
  name: string;
  parentFolderId: string | null;
  weight: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * A tag.
 */
export type AvuxTag = {
  id: string;
  name: string;
  color: string | null;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * An item-tag association.
 */
export type AvuxItemTag = {
  id: string;
  itemId: string;
  tagId: string;
};

/**
 * A custom field definition.
 */
export type AvuxFieldDefinition = {
  id: string;
  fieldType: string;
  label: string;
  isMultiValue: boolean;
  isHidden: boolean;
  enableHistory: boolean;
  weight: number;
  /** The item types this field applies to (JSON array), null for all. */
  applicableToTypes: string | null;
};

/**
 * A logo in the .avux export.
 */
export type AvuxLogo = {
  id: string;
  /** favicon, builtin or custom. */
  kind: string;
  /** The natural key within the kind: a domain, a catalog key or an image hash. */
  source: string;
  /** The user-facing label of an uploaded logo. */
  name: string | null;
  mimeType: string | null;
  fetchedAt: string | null;
  /** The relative path to the logo file in the .avux archive; a builtin logo has no file. */
  relativePath: string;
};

/**
 * The complete manifest of an .avux export.
 */
export type AvuxManifest = {
  version: string;
  exportedAt: string;
  items: AvuxItem[];
  folders: AvuxFolder[];
  tags: AvuxTag[];
  itemTags: AvuxItemTag[];
  fieldDefinitions: AvuxFieldDefinition[];
  logos: AvuxLogo[];
};
