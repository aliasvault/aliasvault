import { FieldKey, FieldTypes, ItemTypes, type ItemType } from '@aliasvault/models/vault';

import { logExpected } from '../../../utilities/Diagnostics';
import { formatDateOnly } from '../../shared/DateTimeUtils';
import { isBlank } from '../../shared/StringUtils';

import { sanitizeTotpSecretKey } from './TotpHelper';

import type { FieldDefinitionEntity, ItemEntity, TotpCodeEntity } from '../../shared/VaultEntities';
import type { ImportedCredential } from '../models/ImportedCredential';

/**
 * Convert one imported credential to a vault item with all its child fields.
 * @param credential - The imported credential
 * @param folderPathToId - Folder paths to folder ids, or null
 * @returns The item
 */
export function convertToItem(credential: ImportedCredential, folderPathToId: Map<string, string> | null): ItemEntity {
  const now = new Date();
  const itemId = crypto.randomUUID();
  const itemType = determineItemType(credential);
  const row = { CreatedAt: credential.CreatedAt ?? now, UpdatedAt: credential.UpdatedAt ?? now, IsDeleted: false };

  const item: ItemEntity = {
    Id: itemId,
    Name: credential.ServiceName ?? '',
    ItemType: itemType,
    FolderId: folderPathToId && !isBlank(credential.FolderPath) ? folderPathToId.get(credential.FolderPath) ?? null : null,
    Logo: null,
    ArchivedAt: null,
    ...row,
    FieldValues: [],
    FieldHistories: [],
    Attachments: (credential.Attachments ?? []).map(attachment => ({ Id: crypto.randomUUID(), ItemId: itemId, Filename: attachment.Filename, Blob: attachment.Blob, ...row })),
    TotpCodes: [],
    Passkeys: (credential.Passkeys ?? []).map(passkey => ({
      Id: passkey.Id ?? crypto.randomUUID(),
      CredentialId: null,
      ItemId: itemId,
      RpId: passkey.RpId,
      UserHandle: passkey.UserHandle ?? new Uint8Array(0),
      PublicKey: passkey.PublicKey,
      PrivateKey: passkey.PrivateKey,
      PrfKey: passkey.PrfKey ?? null,
      DisplayName: passkey.DisplayName,
      AdditionalData: null,
      ...row,
    })),
  };

  /**
   * Add a system field value when the value is not empty.
   */
  const addField = (fieldKey: string, value: string | null | undefined, weight: number = 0): void => {
    if (value) {
      item.FieldValues.push({ Id: crypto.randomUUID(), ItemId: itemId, FieldKey: fieldKey, FieldDefinitionId: null, Value: value, Weight: weight, ...row });
    }
  };

  if (itemType === ItemTypes.CreditCard) {
    const card = credential.Creditcard;
    addField(FieldKey.CardCardholderName, card?.CardholderName);
    addField(FieldKey.CardNumber, card?.Number);
    addField(FieldKey.CardCvv, card?.Cvv);
    addField(FieldKey.CardPin, card?.Pin);
    addField(FieldKey.CardExpiryMonth, card?.ExpiryMonth);
    addField(FieldKey.CardExpiryYear, card?.ExpiryYear);
  } else {
    credential.ServiceUrls?.filter(url => !!url).forEach((url, index) => addField(FieldKey.LoginUrl, url, index));
    addField(FieldKey.LoginUsername, credential.Username);
    addField(FieldKey.LoginPassword, credential.Password);
    addField(FieldKey.LoginEmail, credential.Email);
  }

  addField(FieldKey.NotesContent, credential.Notes);

  const alias = credential.Alias;
  if (alias) {
    addField(FieldKey.AliasFirstName, alias.FirstName);
    addField(FieldKey.AliasLastName, alias.LastName);
    addField(FieldKey.AliasGender, alias.Gender);
    addField(FieldKey.AliasBirthdate, alias.BirthDate ? formatDateOnly(alias.BirthDate) : null);
  }

  const totpCode = credential.TwoFactorSecret ? buildTotpCode(credential.TwoFactorSecret, itemId, row) : null;
  if (totpCode) {
    item.TotpCodes.push(totpCode);
  }

  // Values of the same source definition share one definition.
  const definitionsBySourceId = new Map<string, FieldDefinitionEntity>();
  for (const customField of credential.CustomFieldValues ?? []) {
    if (isBlank(customField.Value) && holdsValue(customField.FieldType)) {
      continue;
    }

    let definition = definitionsBySourceId.get(customField.DefinitionId);
    if (!definition) {
      definition = {
        Id: crypto.randomUUID(),
        Label: customField.Label,
        FieldType: customField.FieldType,
        IsMultiValue: customField.IsMultiValue,
        IsHidden: customField.IsHidden,
        EnableHistory: customField.EnableHistory,
        Weight: customField.Weight,
        ApplicableToTypes: customField.ApplicableToTypes ?? null,
        ...row,
      };
      definitionsBySourceId.set(customField.DefinitionId, definition);
    }

    item.FieldValues.push({ Id: crypto.randomUUID(), ItemId: itemId, FieldDefinition: definition, FieldDefinitionId: definition.Id, FieldKey: null, Value: customField.Value ?? '', Weight: customField.ValueWeight, ...row });
  }

  return item;
}

/**
 * Build the TOTP code of an imported 2FA secret. An invalid secret is logged and skipped so the item itself still imports.
 * @param secret - The bare secret or otpauth:// URI
 * @param itemId - The item id
 * @param row - The row timestamps
 * @returns The TOTP code, or null when the secret is invalid
 */
function buildTotpCode(secret: string, itemId: string, row: Pick<TotpCodeEntity, 'CreatedAt' | 'UpdatedAt' | 'IsDeleted'>): TotpCodeEntity | null {
  try {
    const sanitized = sanitizeTotpSecretKey(secret);
    return { Id: crypto.randomUUID(), ItemId: itemId, Name: sanitized.name ?? '', SecretKey: sanitized.secretKey, Algorithm: sanitized.algorithm, Digits: sanitized.digits, Period: sanitized.period, ...row };
  } catch (error) {
    logExpected('Error importing TOTP code', error);
    return null;
  }
}

/**
 * Determine the item type: what the importer set, else Login; a Login that carries alias data becomes an Alias.
 * @param credential - The credential
 * @returns The item type
 */
function determineItemType(credential: ImportedCredential): ItemType {
  const itemType = credential.ItemType ?? ItemTypes.Login;
  return itemType === ItemTypes.Login && hasAliasData(credential) ? ItemTypes.Alias : itemType;
}

/**
 * Whether the credential carries alias data.
 * @param credential - The credential
 * @returns True when any alias field is set
 */
function hasAliasData(credential: ImportedCredential): boolean {
  const alias = credential.Alias;
  return !!alias && (!!alias.FirstName || !!alias.LastName || !!alias.Gender || !!alias.BirthDate);
}

/**
 * Whether a custom field type is one this build knows to carry a value; blank fields of other types (a section, a newer layout type) are kept.
 * @param fieldType - The field type
 * @returns True for a known value type
 */
function holdsValue(fieldType: string): boolean {
  return fieldType !== FieldTypes.Section && (Object.values(FieldTypes) as string[]).includes(fieldType);
}
