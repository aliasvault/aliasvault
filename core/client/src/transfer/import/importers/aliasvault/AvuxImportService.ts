import { FieldTypes, isItemType, ItemTypes, type FieldType } from '@aliasvault/models/vault';

import { base64ToBytes } from '../../../../utilities/Base64';
import { parseDateTime } from '../../../shared/DateTimeUtils';
import { buildFolderPath } from '../../../shared/FolderPaths';
import { formatTotpUri } from '../../../shared/TotpUri';
import { ZipArchive } from '../../../shared/ZipArchive';
import { parseJson } from '../../readers/JsonReader';

import { parseAvuxManifest } from './AvuxManifestReader';

import type { AvuxAttachment, AvuxFieldDefinition, AvuxFieldValue, AvuxManifest, AvuxPasskey } from '../../../export/AvuxManifest';
import type { ImportedAttachment } from '../../models/ImportedAttachment';
import type { ImportedCredential } from '../../models/ImportedCredential';
import type { ImportedPasskey } from '../../models/ImportedPasskey';

/**
 * Imports vault data from the .avux (AliasVault Unencrypted eXport) format: a ZIP archive with a manifest.json,
 * all attachments and all logos. Logos are embedded into the FaviconBytes of each credential.
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

      return credential;
    });
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
