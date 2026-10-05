import { bytesToBase64 } from '../../utilities/Base64';
import { createZipArchive, textToZipBytes } from '../shared/ZipArchive';

import type { AvuxAttachment, AvuxFieldDefinition, AvuxFieldHistory, AvuxFieldValue, AvuxFolder, AvuxItem, AvuxItemTag, AvuxLogo, AvuxManifest, AvuxPasskey, AvuxTag, AvuxTotpCode } from './AvuxManifest';
import type { AttachmentEntity, FieldDefinitionEntity, FieldHistoryEntity, FieldValueEntity, FolderEntity, ItemEntity, ItemTagEntity, LogoEntity, PasskeyEntity, TagEntity, TotpCodeEntity } from '../shared/VaultEntities';

/** The .avux manifest format version this service writes. */
export const AVUX_FORMAT_VERSION = '1.0.0';

/**
 * Exports vault data to the .avux (AliasVault Unencrypted eXport) format: a ZIP archive with a manifest.json, all
 * attachments and all logos.
 */
export class AvuxExportService {
  /**
   * Export vault data to .avux.
   * @param items - The items to export
   * @param folders - The folders to export
   * @param tags - The tags to export
   * @param itemTags - The item-tag associations to export
   * @param fieldDefinitions - The custom field definitions to export
   * @returns The .avux ZIP file bytes
   */
  public static exportToAvux(items: ItemEntity[], folders: FolderEntity[], tags: TagEntity[], itemTags: ItemTagEntity[], fieldDefinitions: FieldDefinitionEntity[]): Uint8Array {
    const logos = AvuxExportService.itemLogos(items);
    const manifest = AvuxExportService.createManifest(items, folders, tags, itemTags, fieldDefinitions, logos);
    const attachmentMap = AvuxExportService.extractAttachments(items);
    const logoMap = AvuxExportService.extractLogos(logos);

    return AvuxExportService.packageAsZip(manifest, attachmentMap, logoMap);
  }

  /**
   * Build the manifest from the vault entities; deleted rows are left out.
   * @param items - The items
   * @param folders - The folders
   * @param tags - The tags
   * @param itemTags - The item-tag associations
   * @param fieldDefinitions - The custom field definitions
   * @param logos - The logos
   * @returns The manifest
   */
  private static createManifest(items: ItemEntity[], folders: FolderEntity[], tags: TagEntity[], itemTags: ItemTagEntity[], fieldDefinitions: FieldDefinitionEntity[], logos: LogoEntity[]): AvuxManifest {
    return {
      version: AVUX_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      items: items.filter(i => !i.IsDeleted).map(AvuxExportService.mapItemToAvux),
      folders: folders.filter(f => !f.IsDeleted).map(AvuxExportService.mapFolderToAvux),
      tags: tags.filter(t => !t.IsDeleted).map(AvuxExportService.mapTagToAvux),
      itemTags: itemTags.filter(it => !it.IsDeleted).map(AvuxExportService.mapItemTagToAvux),
      fieldDefinitions: fieldDefinitions.filter(fd => !fd.IsDeleted).map(AvuxExportService.mapFieldDefinitionToAvux),
      logos: logos.map(AvuxExportService.mapLogoToAvux),
    };
  }

  /**
   * Get all the live logos of the live items.
   * @param items - The items
   * @returns The logos, one per id
   */
  private static itemLogos(items: ItemEntity[]): LogoEntity[] {
    const logosById = new Map<string, LogoEntity>();
    for (const item of items.filter(i => !i.IsDeleted)) {
      if (item.Logo && !item.Logo.IsDeleted) {
        logosById.set(item.Logo.Id, item.Logo);
      }
    }
    return [...logosById.values()];
  }

  /**
   * Map an item.
   * @param item - The item
   * @returns The manifest item
   */
  private static mapItemToAvux(item: ItemEntity): AvuxItem {
    return {
      id: item.Id,
      name: item.Name,
      itemType: item.ItemType,
      createdAt: item.CreatedAt.toISOString(),
      updatedAt: item.UpdatedAt.toISOString(),
      folderId: item.FolderId,
      logoId: item.Logo && !item.Logo.IsDeleted ? item.Logo.Id : null,
      archivedAt: item.ArchivedAt ? item.ArchivedAt.toISOString() : null,
      fieldValues: item.FieldValues.filter(fv => !fv.IsDeleted).map(AvuxExportService.mapFieldValueToAvux),
      fieldHistories: item.FieldHistories.filter(fh => !fh.IsDeleted).map(AvuxExportService.mapFieldHistoryToAvux),
      attachments: item.Attachments.filter(a => !a.IsDeleted).map(AvuxExportService.mapAttachmentToAvux),
      totpCodes: item.TotpCodes.filter(tc => !tc.IsDeleted).map(AvuxExportService.mapTotpCodeToAvux),
      passkeys: item.Passkeys.filter(p => !p.IsDeleted).map(AvuxExportService.mapPasskeyToAvux),
    };
  }

  /**
   * Map a field value.
   * @param fieldValue - The field value
   * @returns The manifest field value
   */
  private static mapFieldValueToAvux(fieldValue: FieldValueEntity): AvuxFieldValue {
    return {
      id: fieldValue.Id,
      fieldKey: fieldValue.FieldKey,
      fieldDefinitionId: fieldValue.FieldDefinitionId,
      value: fieldValue.Value,
      weight: fieldValue.Weight,
    };
  }

  /**
   * Map a field history record.
   * @param fieldHistory - The field history record
   * @returns The manifest field history record
   */
  private static mapFieldHistoryToAvux(fieldHistory: FieldHistoryEntity): AvuxFieldHistory {
    return {
      id: fieldHistory.Id,
      fieldKey: fieldHistory.FieldKey,
      fieldDefinitionId: fieldHistory.FieldDefinitionId,
      valueSnapshot: fieldHistory.ValueSnapshot,
      changedAt: fieldHistory.ChangedAt.toISOString(),
    };
  }

  /**
   * Map an attachment.
   * @param attachment - The attachment
   * @returns The manifest attachment
   */
  private static mapAttachmentToAvux(attachment: AttachmentEntity): AvuxAttachment {
    return {
      id: attachment.Id,
      filename: attachment.Filename,
      relativePath: AvuxExportService.attachmentPath(attachment),
    };
  }

  /**
   * Map a TOTP code.
   * @param totpCode - The TOTP code
   * @returns The manifest TOTP code
   */
  private static mapTotpCodeToAvux(totpCode: TotpCodeEntity): AvuxTotpCode {
    return {
      id: totpCode.Id,
      name: totpCode.Name,
      secretKey: totpCode.SecretKey,
      algorithm: totpCode.Algorithm,
      digits: totpCode.Digits,
      period: totpCode.Period,
    };
  }

  /**
   * Map a passkey.
   * @param passkey - The passkey
   * @returns The manifest passkey
   */
  private static mapPasskeyToAvux(passkey: PasskeyEntity): AvuxPasskey {
    return {
      id: passkey.Id,
      credentialId: passkey.CredentialId ? bytesToBase64(passkey.CredentialId) : null,
      rpId: passkey.RpId,
      userHandle: passkey.UserHandle ? bytesToBase64(passkey.UserHandle) : null,
      publicKey: passkey.PublicKey,
      privateKey: passkey.PrivateKey,
      prfKey: passkey.PrfKey ? bytesToBase64(passkey.PrfKey) : null,
      displayName: passkey.DisplayName,
      additionalData: passkey.AdditionalData ? bytesToBase64(passkey.AdditionalData) : null,
    };
  }

  /**
   * Map a folder.
   * @param folder - The folder
   * @returns The manifest folder
   */
  private static mapFolderToAvux(folder: FolderEntity): AvuxFolder {
    return {
      id: folder.Id,
      name: folder.Name,
      parentFolderId: folder.ParentFolderId,
      weight: folder.Weight,
      createdAt: folder.CreatedAt.toISOString(),
      updatedAt: folder.UpdatedAt.toISOString(),
    };
  }

  /**
   * Map a tag.
   * @param tag - The tag
   * @returns The manifest tag
   */
  private static mapTagToAvux(tag: TagEntity): AvuxTag {
    return {
      id: tag.Id,
      name: tag.Name,
      color: tag.Color,
      displayOrder: tag.DisplayOrder,
      createdAt: tag.CreatedAt.toISOString(),
      updatedAt: tag.UpdatedAt.toISOString(),
    };
  }

  /**
   * Map an item-tag association.
   * @param itemTag - The association
   * @returns The manifest association
   */
  private static mapItemTagToAvux(itemTag: ItemTagEntity): AvuxItemTag {
    return {
      id: crypto.randomUUID(),
      itemId: itemTag.ItemId,
      tagId: itemTag.TagId,
    };
  }

  /**
   * Map a custom field definition.
   * @param fieldDefinition - The definition
   * @returns The manifest definition
   */
  private static mapFieldDefinitionToAvux(fieldDefinition: FieldDefinitionEntity): AvuxFieldDefinition {
    return {
      id: fieldDefinition.Id,
      fieldType: fieldDefinition.FieldType,
      label: fieldDefinition.Label,
      isMultiValue: fieldDefinition.IsMultiValue,
      isHidden: fieldDefinition.IsHidden,
      enableHistory: fieldDefinition.EnableHistory,
      weight: fieldDefinition.Weight,
      applicableToTypes: fieldDefinition.ApplicableToTypes,
    };
  }

  /**
   * Map a logo.
   * @param logo - The logo
   * @returns The manifest logo
   */
  private static mapLogoToAvux(logo: LogoEntity): AvuxLogo {
    return {
      id: logo.Id,
      kind: logo.Kind,
      source: logo.Source,
      name: logo.Name,
      mimeType: logo.MimeType,
      fetchedAt: logo.FetchedAt ? logo.FetchedAt.toISOString() : null,
      relativePath: AvuxExportService.logoPath(logo),
    };
  }

  /**
   * The archive path of an attachment.
   * @param attachment - The attachment
   * @returns The path
   */
  private static attachmentPath(attachment: AttachmentEntity): string {
    return `attachments/${attachment.ItemId}_${attachment.Id}_${attachment.Filename}`;
  }

  /**
   * The archive path of a logo.
   * @param logo - The logo
   * @returns The path
   */
  private static logoPath(logo: LogoEntity): string {
    return `logos/${logo.Source}_${logo.Id}.png`;
  }

  /**
   * Collect the attachment blobs of the live items, keyed by archive path.
   * @param items - The items
   * @returns Archive paths to blob data
   */
  private static extractAttachments(items: ItemEntity[]): Map<string, Uint8Array> {
    const attachmentMap = new Map<string, Uint8Array>();
    for (const item of items.filter(i => !i.IsDeleted)) {
      for (const attachment of item.Attachments.filter(a => !a.IsDeleted && a.Blob)) {
        attachmentMap.set(`attachments/${item.Id}_${attachment.Id}_${attachment.Filename}`, attachment.Blob as Uint8Array);
      }
    }
    return attachmentMap;
  }

  /**
   * Collect the logo images, keyed by archive path.
   * @param logos - The logos
   * @returns Archive paths to image data
   */
  private static extractLogos(logos: LogoEntity[]): Map<string, Uint8Array> {
    const logoMap = new Map<string, Uint8Array>();
    for (const logo of logos.filter(l => !l.IsDeleted && l.FileData !== null)) {
      logoMap.set(AvuxExportService.logoPath(logo), logo.FileData!);
    }
    return logoMap;
  }

  /**
   * Package the manifest, attachments and logos into a ZIP archive.
   * @param manifest - The manifest
   * @param attachments - Archive paths to attachment data
   * @param logos - Archive paths to logo data
   * @returns The ZIP bytes
   */
  private static packageAsZip(manifest: AvuxManifest, attachments: Map<string, Uint8Array>, logos: Map<string, Uint8Array>): Uint8Array {
    const files: Record<string, Uint8Array> = {
      'manifest.json': textToZipBytes(JSON.stringify(manifest, null, 2)),
    };
    for (const [path, data] of attachments) {
      files[path] = data;
    }
    for (const [path, data] of logos) {
      files[path] = data;
    }
    return createZipArchive(files);
  }
}
