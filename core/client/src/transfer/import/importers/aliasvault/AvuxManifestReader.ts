import { LogoKinds } from '@aliasvault/models/vault';

import { readBoolean, readNumber, readObjectArray, readString, requireObject, type JsonObject } from '../../readers/JsonReader';

import type { AvuxAttachment, AvuxFieldDefinition, AvuxFieldHistory, AvuxFieldValue, AvuxFolder, AvuxItem, AvuxItemTag, AvuxLogo, AvuxManifest, AvuxPasskey, AvuxTag, AvuxTotpCode } from '../../../export/AvuxManifest';

/**
 * Read an .avux manifest.json, matching property names case-insensitively.
 * @param root - The parsed manifest JSON
 * @returns The manifest
 * @throws {JsonException} When a value has the wrong type.
 */
export function parseAvuxManifest(root: unknown): AvuxManifest {
  const obj = requireObject(root, 'manifest.json');
  return {
    version: readString(obj, 'version') ?? '1.0.0',
    exportedAt: readString(obj, 'exportedAt') ?? '',
    items: readObjectArray(obj, 'items', parseAvuxItem) ?? [],
    folders: readObjectArray(obj, 'folders', parseAvuxFolder) ?? [],
    tags: readObjectArray(obj, 'tags', parseAvuxTag) ?? [],
    itemTags: readObjectArray(obj, 'itemTags', parseAvuxItemTag) ?? [],
    fieldDefinitions: readObjectArray(obj, 'fieldDefinitions', parseAvuxFieldDefinition) ?? [],
    logos: readObjectArray(obj, 'logos', parseAvuxLogo) ?? [],
  };
}

/**
 * Read an item.
 * @param obj - The item JSON
 * @returns The item
 */
function parseAvuxItem(obj: JsonObject): AvuxItem {
  return {
    id: readString(obj, 'id') ?? '',
    name: readString(obj, 'name'),
    itemType: readString(obj, 'itemType') ?? '',
    createdAt: readString(obj, 'createdAt') ?? '',
    updatedAt: readString(obj, 'updatedAt') ?? '',
    folderId: readString(obj, 'folderId'),
    logoId: readString(obj, 'logoId'),
    archivedAt: readString(obj, 'archivedAt'),
    fieldValues: readObjectArray(obj, 'fieldValues', parseAvuxFieldValue) ?? [],
    fieldHistories: readObjectArray(obj, 'fieldHistories', parseAvuxFieldHistory) ?? [],
    attachments: readObjectArray(obj, 'attachments', parseAvuxAttachment) ?? [],
    totpCodes: readObjectArray(obj, 'totpCodes', parseAvuxTotpCode) ?? [],
    passkeys: readObjectArray(obj, 'passkeys', parseAvuxPasskey) ?? [],
  };
}

/**
 * Read a field value.
 * @param obj - The field value JSON
 * @returns The field value
 */
function parseAvuxFieldValue(obj: JsonObject): AvuxFieldValue {
  return {
    id: readString(obj, 'id') ?? '',
    fieldKey: readString(obj, 'fieldKey'),
    fieldDefinitionId: readString(obj, 'fieldDefinitionId'),
    value: readString(obj, 'value'),
    weight: readNumber(obj, 'weight') ?? 0,
  };
}

/**
 * Read a field history record.
 * @param obj - The field history JSON
 * @returns The field history record
 */
function parseAvuxFieldHistory(obj: JsonObject): AvuxFieldHistory {
  return {
    id: readString(obj, 'id') ?? '',
    fieldKey: readString(obj, 'fieldKey'),
    fieldDefinitionId: readString(obj, 'fieldDefinitionId'),
    valueSnapshot: readString(obj, 'valueSnapshot') ?? '',
    changedAt: readString(obj, 'changedAt') ?? '',
  };
}

/**
 * Read an attachment.
 * @param obj - The attachment JSON
 * @returns The attachment
 */
function parseAvuxAttachment(obj: JsonObject): AvuxAttachment {
  return {
    id: readString(obj, 'id') ?? '',
    filename: readString(obj, 'filename') ?? '',
    relativePath: readString(obj, 'relativePath') ?? '',
  };
}

/**
 * Read a TOTP code.
 * @param obj - The TOTP code JSON
 * @returns The TOTP code
 */
function parseAvuxTotpCode(obj: JsonObject): AvuxTotpCode {
  return {
    id: readString(obj, 'id') ?? '',
    name: readString(obj, 'name') ?? '',
    secretKey: readString(obj, 'secretKey') ?? '',
    algorithm: readString(obj, 'algorithm') ?? 'SHA1',
    digits: readNumber(obj, 'digits') ?? 6,
    period: readNumber(obj, 'period') ?? 30,
  };
}

/**
 * Read a passkey.
 * @param obj - The passkey JSON
 * @returns The passkey
 */
function parseAvuxPasskey(obj: JsonObject): AvuxPasskey {
  return {
    id: readString(obj, 'id') ?? '',
    credentialId: readString(obj, 'credentialId'),
    rpId: readString(obj, 'rpId') ?? '',
    userHandle: readString(obj, 'userHandle'),
    publicKey: readString(obj, 'publicKey') ?? '',
    privateKey: readString(obj, 'privateKey') ?? '',
    prfKey: readString(obj, 'prfKey'),
    displayName: readString(obj, 'displayName') ?? '',
    additionalData: readString(obj, 'additionalData'),
  };
}

/**
 * Read a folder.
 * @param obj - The folder JSON
 * @returns The folder
 */
function parseAvuxFolder(obj: JsonObject): AvuxFolder {
  return {
    id: readString(obj, 'id') ?? '',
    name: readString(obj, 'name') ?? '',
    parentFolderId: readString(obj, 'parentFolderId'),
    weight: readNumber(obj, 'weight') ?? 0,
    createdAt: readString(obj, 'createdAt') ?? '',
    updatedAt: readString(obj, 'updatedAt') ?? '',
  };
}

/**
 * Read a tag.
 * @param obj - The tag JSON
 * @returns The tag
 */
function parseAvuxTag(obj: JsonObject): AvuxTag {
  return {
    id: readString(obj, 'id') ?? '',
    name: readString(obj, 'name') ?? '',
    color: readString(obj, 'color'),
    displayOrder: readNumber(obj, 'displayOrder') ?? 0,
    createdAt: readString(obj, 'createdAt') ?? '',
    updatedAt: readString(obj, 'updatedAt') ?? '',
  };
}

/**
 * Read an item-tag association.
 * @param obj - The association JSON
 * @returns The association
 */
function parseAvuxItemTag(obj: JsonObject): AvuxItemTag {
  return {
    id: readString(obj, 'id') ?? '',
    itemId: readString(obj, 'itemId') ?? '',
    tagId: readString(obj, 'tagId') ?? '',
  };
}

/**
 * Read a custom field definition.
 * @param obj - The definition JSON
 * @returns The definition
 */
function parseAvuxFieldDefinition(obj: JsonObject): AvuxFieldDefinition {
  return {
    id: readString(obj, 'id') ?? '',
    fieldType: readString(obj, 'fieldType') ?? '',
    label: readString(obj, 'label') ?? '',
    isMultiValue: readBoolean(obj, 'isMultiValue') ?? false,
    isHidden: readBoolean(obj, 'isHidden') ?? false,
    enableHistory: readBoolean(obj, 'enableHistory') ?? false,
    weight: readNumber(obj, 'weight') ?? 0,
    applicableToTypes: readString(obj, 'applicableToTypes'),
  };
}

/**
 * Read a logo.
 * @param obj - The logo JSON
 * @returns The logo
 */
function parseAvuxLogo(obj: JsonObject): AvuxLogo {
  return {
    id: readString(obj, 'id') ?? '',
    kind: readString(obj, 'kind') ?? LogoKinds.Favicon,
    source: readString(obj, 'source') ?? '',
    name: readString(obj, 'name'),
    mimeType: readString(obj, 'mimeType'),
    fetchedAt: readString(obj, 'fetchedAt'),
    relativePath: readString(obj, 'relativePath') ?? '',
  };
}
