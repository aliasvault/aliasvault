import { FieldTypes, isItemType, ItemTypes, LogoKinds, normalizeTotpAlgorithm, normalizeTotpDigits, normalizeTotpPeriod, type FieldType, type LogoKind } from '@aliasvault/models/vault';

import { base64ToBytes } from '../../../../utilities/Base64';
import { parseDateTime } from '../../../shared/DateTimeUtils';
import { buildFolderPath } from '../../../shared/FolderPaths';
import { formatTotpUri } from '../../../shared/TotpUri';
import { ZipArchive } from '../../../shared/ZipArchive';
import { parseJson } from '../../readers/JsonReader';

import { parseAvuxManifest } from './AvuxManifestReader';

import type { AvuxAttachment, AvuxFieldDefinition, AvuxFieldValue, AvuxItem, AvuxManifest, AvuxPasskey } from '../../../export/AvuxManifest';
import type { AttachmentEntity, FieldDefinitionEntity, ItemEntity, LogoEntity, TagEntity } from '../../../shared/VaultEntities';
import type { ImportedAttachment } from '../../models/ImportedAttachment';
import type { ImportedCredential } from '../../models/ImportedCredential';
import type { ImportedPasskey } from '../../models/ImportedPasskey';

/**
 * The rows an .avux manifest shares between its items, each under a new id for the vault it is imported into.
 */
type SharedRows = {
  definitions: Map<string, FieldDefinitionEntity>;
  tagsByItem: Map<string, TagEntity[]>;
  logos: Map<string, LogoEntity>;
};

/**
 * Imports vault data from the .avux (AliasVault Unencrypted eXport) format: a ZIP archive with a manifest.json,
 * all attachments and all logos.
 *
 * Every credential carries the complete item as AliasVaultItem, which is what gets written as-is.
 */
export class AvuxImportService {
  /**
   * Import an .avux file.
   * @param zipBytes - The .avux file bytes
   * @returns The credentials, with embedded logo data
   * @throws {Error} When the archive is invalid or its manifest cannot be read.
   */
  public static importFromAvux(zipBytes: Uint8Array): ImportedCredential[] {
    const archive = ZipArchive.open(zipBytes);

    const manifestText = archive.readText('manifest.json');
    if (manifestText === null) {
      throw new Error('Invalid .avux file: manifest.json not found');
    }

    const manifest = parseAvuxManifest(parseJson(manifestText));
    if (manifest.version !== '1.0.0') {
      throw new Error(`Unsupported .avux version: ${manifest.version}. Expected 1.0.0.`);
    }

    const logoFiles = archive.filesUnder('logos/');
    const logoDataById = new Map<string, Uint8Array>();
    for (const logo of manifest.logos) {
      const fileData = logoFiles.get(logo.relativePath);
      if (fileData) {
        logoDataById.set(logo.id, fileData);
      }
    }

    return AvuxImportService.convertManifestToImportedCredentials(manifest, archive.filesUnder('attachments/'), logoDataById);
  }

  /**
   * Convert the manifest and its files to credentials.
   * @param manifest - The manifest
   * @param attachmentMap - Attachment paths to file data
   * @param logoDataById - Logo ids to image data
   * @returns The credentials
   */
  private static convertManifestToImportedCredentials(manifest: AvuxManifest, attachmentMap: Map<string, Uint8Array>, logoDataById: Map<string, Uint8Array>): ImportedCredential[] {
    const foldersById = new Map(manifest.folders.map(folder => [folder.id, { Name: folder.name, ParentFolderId: folder.parentFolderId }]));
    const fieldDefinitionsById = new Map(manifest.fieldDefinitions.map(fd => [fd.id, fd]));
    const sharedRows = AvuxImportService.buildSharedRows(manifest, logoDataById);

    return manifest.items.map((item): ImportedCredential => {
      const credential: ImportedCredential = {
        ServiceName: item.name,
        CreatedAt: parseDateTime(item.createdAt),
        UpdatedAt: parseDateTime(item.updatedAt),
        ItemType: isItemType(item.itemType) ? item.itemType : ItemTypes.Login,
      };

      if (item.logoId) {
        const logoBytes = logoDataById.get(item.logoId);
        if (logoBytes) {
          credential.FaviconBytes = logoBytes;
        }
      }

      if (item.folderId) {
        credential.FolderPath = foldersById.has(item.folderId) ? buildFolderPath(item.folderId, foldersById) : null;
      }

      AvuxImportService.extractFieldValues(credential, item.fieldValues, fieldDefinitionsById);

      // The import format carries one TOTP per item, as a URI so its name and parameters survive.
      if (item.totpCodes.length > 0) {
        const totpCode = item.totpCodes[0];
        credential.TwoFactorSecret = formatTotpUri({ Name: totpCode.name, SecretKey: totpCode.secretKey, Algorithm: totpCode.algorithm, Digits: totpCode.digits, Period: totpCode.period });
      }

      if (item.passkeys.length > 0) {
        credential.Passkeys = item.passkeys.map(AvuxImportService.mapAvuxPasskeyToImported);
      }

      if (item.attachments.length > 0) {
        credential.Attachments = item.attachments.map(a => AvuxImportService.mapAvuxAttachmentToImported(a, attachmentMap));
      }

      credential.AliasVaultItem = AvuxImportService.buildItem(item, credential, sharedRows, attachmentMap);

      return credential;
    });
  }

  /**
   * Create the custom field definitions, tags and logos the items share, under new ids.
   * @param manifest - The manifest
   * @param logoDataById - Logo ids to image data
   * @returns The shared rows, keyed by their id in the manifest (tags by the id of the item they are on)
   */
  private static buildSharedRows(manifest: AvuxManifest, logoDataById: Map<string, Uint8Array>): SharedRows {
    const now = new Date();

    const definitions = new Map(manifest.fieldDefinitions.map((definition): [string, FieldDefinitionEntity] => [definition.id, {
      Id: crypto.randomUUID(),
      FieldType: AvuxImportService.toFieldType(definition.fieldType),
      Label: definition.label,
      IsMultiValue: definition.isMultiValue,
      IsHidden: definition.isHidden,
      EnableHistory: definition.enableHistory,
      Weight: definition.weight,
      ApplicableToTypes: definition.applicableToTypes,
      CreatedAt: now,
      UpdatedAt: now,
      IsDeleted: false,
    }]));

    const tags = new Map(manifest.tags.filter(tag => tag.name.trim().length > 0).map((tag): [string, TagEntity] => [tag.id, {
      Id: crypto.randomUUID(),
      Name: tag.name,
      Color: tag.color,
      DisplayOrder: tag.displayOrder,
      CreatedAt: parseDateTime(tag.createdAt) ?? now,
      UpdatedAt: parseDateTime(tag.updatedAt) ?? now,
      IsDeleted: false,
    }]));
    const tagsByItem = new Map<string, TagEntity[]>();
    for (const itemTag of manifest.itemTags) {
      const tag = tags.get(itemTag.tagId);
      if (tag) {
        tagsByItem.set(itemTag.itemId, [...tagsByItem.get(itemTag.itemId) ?? [], tag]);
      }
    }

    const logos = new Map<string, LogoEntity>();
    for (const logo of manifest.logos) {
      const kind = AvuxImportService.toLogoKind(logo.kind);
      if (kind && logo.source.length > 0) {
        logos.set(logo.id, { Id: logo.id, Kind: kind, Source: logo.source, Name: logo.name, FileData: logoDataById.get(logo.id) ?? null, MimeType: logo.mimeType, FetchedAt: parseDateTime(logo.fetchedAt), IsDeleted: false });
      }
    }

    return { definitions, tagsByItem, logos };
  }

  /**
   * Build the complete item graph of a manifest item, under new ids. Passkeys keep theirs, since the WebAuthn
   * credential id the relying party knows is derived from it.
   * @param item - The manifest item
   * @param credential - The credential summary of the item, for its dates and item type
   * @param sharedRows - The definitions, tags and logos the items share
   * @param attachmentMap - Attachment paths to file data
   * @returns The item
   */
  private static buildItem(item: AvuxItem, credential: ImportedCredential, sharedRows: SharedRows, attachmentMap: Map<string, Uint8Array>): ItemEntity {
    const now = new Date();
    const itemId = crypto.randomUUID();
    const row = { CreatedAt: credential.CreatedAt ?? now, UpdatedAt: credential.UpdatedAt ?? now, IsDeleted: false };
    /**
     * The new definition of a manifest definition id, or null for a system field or an unknown definition.
     */
    const definitionOf = (definitionId: string | null): FieldDefinitionEntity | null => definitionId ? sharedRows.definitions.get(definitionId) ?? null : null;

    const attachments: AttachmentEntity[] = [];
    for (const attachment of item.attachments) {
      const blob = attachmentMap.get(attachment.relativePath);
      if (blob && blob.length > 0) {
        attachments.push({ Id: crypto.randomUUID(), ItemId: itemId, Filename: attachment.filename, Blob: blob, ...row });
      }
    }

    return {
      Id: itemId,
      Name: item.name,
      ItemType: credential.ItemType ?? ItemTypes.Login,
      FolderId: null,
      ArchivedAt: parseDateTime(item.archivedAt),
      ...row,
      // A value or history record is either a system field or a custom field whose definition the file holds.
      FieldValues: item.fieldValues.filter(fv => fv.fieldKey || definitionOf(fv.fieldDefinitionId)).map(fv => {
        const definition = definitionOf(fv.fieldDefinitionId);
        return { Id: crypto.randomUUID(), ItemId: itemId, FieldKey: definition ? null : fv.fieldKey, FieldDefinitionId: definition?.Id ?? null, FieldDefinition: definition, Value: fv.value, Weight: fv.weight, ...row };
      }),
      FieldHistories: item.fieldHistories.filter(fh => fh.fieldKey || definitionOf(fh.fieldDefinitionId)).map(fh => {
        const definition = definitionOf(fh.fieldDefinitionId);
        const changedAt = parseDateTime(fh.changedAt) ?? row.UpdatedAt;
        return { Id: crypto.randomUUID(), ItemId: itemId, FieldKey: definition ? null : fh.fieldKey, FieldDefinitionId: definition?.Id ?? null, FieldDefinition: definition, ValueSnapshot: fh.valueSnapshot, ChangedAt: changedAt, CreatedAt: changedAt, UpdatedAt: changedAt, IsDeleted: false };
      }),
      Attachments: attachments,
      TotpCodes: item.totpCodes.filter(totp => totp.secretKey.length > 0).map(totp => ({
        Id: crypto.randomUUID(),
        ItemId: itemId,
        Name: totp.name,
        SecretKey: totp.secretKey,
        Algorithm: normalizeTotpAlgorithm(totp.algorithm),
        Digits: normalizeTotpDigits(totp.digits),
        Period: normalizeTotpPeriod(totp.period),
        ...row,
      })),
      Passkeys: item.passkeys.map(passkey => ({
        Id: passkey.id.length > 0 ? passkey.id : crypto.randomUUID(),
        CredentialId: passkey.credentialId ? base64ToBytes(passkey.credentialId) : null,
        ItemId: itemId,
        RpId: passkey.rpId,
        UserHandle: passkey.userHandle ? base64ToBytes(passkey.userHandle) : new Uint8Array(0),
        PublicKey: passkey.publicKey,
        PrivateKey: passkey.privateKey,
        PrfKey: passkey.prfKey ? base64ToBytes(passkey.prfKey) : null,
        DisplayName: passkey.displayName,
        AdditionalData: passkey.additionalData ? base64ToBytes(passkey.additionalData) : null,
        ...row,
      })),
      Logo: item.logoId ? sharedRows.logos.get(item.logoId) ?? null : null,
      Tags: sharedRows.tagsByItem.get(item.id) ?? [],
    };
  }

  /**
   * Map a logo kind string to a known logo kind.
   * @param value - The logo kind text
   * @returns The logo kind, or null when this version does not know it
   */
  private static toLogoKind(value: string): LogoKind | null {
    return (Object.values(LogoKinds) as string[]).includes(value) ? value as LogoKind : null;
  }

  /**
   * Fill the credential from the item's field values: system fields map to properties, custom fields become
   * custom field values with their definition's metadata.
   * @param credential - The credential to fill
   * @param fieldValues - The item's field values
   * @param fieldDefinitionsById - The custom field definitions by id
   */
  private static extractFieldValues(credential: ImportedCredential, fieldValues: AvuxFieldValue[], fieldDefinitionsById: Map<string, AvuxFieldDefinition>): void {
    for (const fieldValue of fieldValues) {
      if (!fieldValue.fieldKey) {
        const definition = fieldValue.fieldDefinitionId ? fieldDefinitionsById.get(fieldValue.fieldDefinitionId) : undefined;
        if (definition) {
          credential.CustomFieldValues ??= [];
          credential.CustomFieldValues.push({
            DefinitionId: definition.id,
            Label: definition.label,
            Value: fieldValue.value,
            FieldType: AvuxImportService.toFieldType(definition.fieldType),
            IsMultiValue: definition.isMultiValue,
            IsHidden: definition.isHidden,
            EnableHistory: definition.enableHistory,
            Weight: definition.weight,
            ValueWeight: fieldValue.weight,
            ApplicableToTypes: definition.applicableToTypes,
          });
        }
        continue;
      }

      switch (fieldValue.fieldKey) {
        case 'login.username':
          credential.Username = fieldValue.value;
          break;
        case 'login.password':
          credential.Password = fieldValue.value;
          break;
        case 'login.email':
          credential.Email = fieldValue.value;
          break;
        case 'login.url':
          credential.ServiceUrls ??= [];
          if (fieldValue.value) {
            credential.ServiceUrls.push(fieldValue.value);
          }
          break;
        case 'notes.content':
          credential.Notes = fieldValue.value;
          break;
        case 'alias.first_name':
          credential.Alias ??= {};
          credential.Alias.FirstName = fieldValue.value;
          break;
        case 'alias.last_name':
          credential.Alias ??= {};
          credential.Alias.LastName = fieldValue.value;
          break;
        case 'alias.gender':
          credential.Alias ??= {};
          credential.Alias.Gender = fieldValue.value;
          break;
        case 'alias.birthdate': {
          credential.Alias ??= {};
          const birthdate = parseDateTime(fieldValue.value);
          if (birthdate) {
            credential.Alias.BirthDate = birthdate;
          }
          break;
        }
        case 'card.number':
          credential.Creditcard ??= {};
          credential.Creditcard.Number = fieldValue.value;
          break;
        case 'card.cardholder_name':
          credential.Creditcard ??= {};
          credential.Creditcard.CardholderName = fieldValue.value;
          break;
        case 'card.expiry_month':
          credential.Creditcard ??= {};
          credential.Creditcard.ExpiryMonth = fieldValue.value;
          break;
        case 'card.expiry_year':
          credential.Creditcard ??= {};
          credential.Creditcard.ExpiryYear = fieldValue.value;
          break;
        case 'card.cvv':
          credential.Creditcard ??= {};
          credential.Creditcard.Cvv = fieldValue.value;
          break;
        case 'card.pin':
          credential.Creditcard ??= {};
          credential.Creditcard.Pin = fieldValue.value;
          break;
      }
    }
  }

  /**
   * Map a field type string to a known field type, Text for anything unknown.
   * @param value - The field type text
   * @returns The field type
   */
  private static toFieldType(value: string): FieldType {
    return (Object.values(FieldTypes) as string[]).includes(value) ? value as FieldType : FieldTypes.Text;
  }

  /**
   * Map a manifest passkey to an imported passkey.
   * @param avuxPasskey - The manifest passkey
   * @returns The imported passkey
   */
  private static mapAvuxPasskeyToImported(avuxPasskey: AvuxPasskey): ImportedPasskey {
    return {
      Id: avuxPasskey.id,
      RpId: avuxPasskey.rpId,
      UserHandle: avuxPasskey.userHandle ? base64ToBytes(avuxPasskey.userHandle) : null,
      PublicKey: avuxPasskey.publicKey,
      PrivateKey: avuxPasskey.privateKey,
      PrfKey: avuxPasskey.prfKey ? base64ToBytes(avuxPasskey.prfKey) : null,
      DisplayName: avuxPasskey.displayName,
    };
  }

  /**
   * Map a manifest attachment to an imported attachment, resolving its data from the archive.
   * @param avuxAttachment - The manifest attachment
   * @param attachmentMap - Attachment paths to file data
   * @returns The imported attachment; empty when the file is missing
   */
  private static mapAvuxAttachmentToImported(avuxAttachment: AvuxAttachment, attachmentMap: Map<string, Uint8Array>): ImportedAttachment {
    return {
      Filename: avuxAttachment.filename,
      Blob: attachmentMap.get(avuxAttachment.relativePath) ?? new Uint8Array(0),
    };
  }
}
