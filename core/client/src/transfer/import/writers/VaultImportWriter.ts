import { FieldKey, LogoKinds, type Item } from '@aliasvault/models/vault';

import { scopedKey } from '../../../database/ItemRef';
import { createImportWriteSession } from '../../../database/repositories/ImportExportRepository';
import { selectFaviconTarget } from '../../../rust/RustCore';
import { buildFolderPath } from '../../shared/FolderPaths';
import { isBlank } from '../../shared/StringUtils';
import { ImportException, ImportStage } from '../models/ImportException';

import { detectAndRemoveDuplicates, isDuplicateItem } from './ImportDuplicateDetection';
import { convertToItem } from './ItemConverter';
import { isEmptyEnrichment, detectItemEnrichment, type ExistingItemData, type ItemEnrichment } from './ItemEnrichment';

import type { ImportEnrichment, ImportPreview } from './ImportDuplicateDetection';
import type { ItemRef } from '../../../database/ItemRef';
import type { ImportExportRepository, ImportWriteSession } from '../../../database/repositories/ImportExportRepository';
import type { SqliteClient } from '../../../database/SqliteClient';
import type { FolderNode } from '../../shared/FolderPaths';
import type { ItemEntity, LogoEntity } from '../../shared/VaultEntities';
import type { ImportedCredential } from '../models/ImportedCredential';

/**
 * How an import is written.
 */
export type VaultImportOptions = {
  folderNameToId?: Map<string, string> | null;
  enrichments?: ImportEnrichment[];
  importAttachments: boolean;
  extractedFavicons: Map<string, Uint8Array>;
  onProgress?: (saved: number, total: number) => Promise<void> | void;
};

/**
 * The part of a vault client the writer uses. This type allows both the web `SqliteClient` and the mobile `SqliteClient` to be able to be used.
 */
export type ImportTargetClient = {
  getPersonalManifestId(): string | null | Promise<string | null>;
  folders: {
    getAll(): (FolderNode & { Id: string; ManifestId: string })[] | Promise<(FolderNode & { Id: string; ManifestId: string })[]>;
    create(name: string, parent: { Id: string; ManifestId: string } | null): Promise<string>;
  };
  importExport: {
    insertImportedItem(item: ItemEntity, logoId: string | null, session?: ImportWriteSession): Promise<void>;
    resolveImportLogo: ImportExportRepository['resolveImportLogo'];
    resolveCarriedLogo(logo: LogoEntity): Promise<string | null>;
    getExistingItemData(ref: ItemRef): ExistingItemData | Promise<ExistingItemData>;
    insertItemEnrichment(ref: ItemRef, enrichment: ItemEnrichment, session?: ImportWriteSession): Promise<void>;
  };
};

/**
 * Writes imported credentials into the vault: creates the folders, resolves each item's logo and inserts the item
 * and its fields.
 */
export class VaultImportWriter {
  /**
   * Create the folders an import needs, reusing the ones that already exist by full path, and
   * map every path to its folder id. Parents come before children.
   * @param sqliteClient - The vault
   * @param folderPaths - The hierarchical folder paths, parents first (see collectHierarchicalFolderPaths)
   * @returns Folder paths to folder ids
   */
  public static async createOrGetFolders(sqliteClient: ImportTargetClient, folderPaths: string[]): Promise<Map<string, string>> {
    const folderPathToId = new Map<string, string>();
    const idsByLowerPath = new Map<string, string>();

    // Imported items land in the personal manifest, so only its folders can hold them.
    const manifestId = await sqliteClient.getPersonalManifestId();
    if (!manifestId) {
      throw new Error('VaultImportWriter: this client has no personal manifest recorded yet; sync once before importing.');
    }

    const existingFolders = (await sqliteClient.folders.getAll()).filter(folder => folder.ManifestId === manifestId);
    const foldersById = new Map(existingFolders.map(folder => [folder.Id, folder]));
    for (const folder of existingFolders) {
      idsByLowerPath.set(buildFolderPath(folder.Id, foldersById).toLowerCase(), folder.Id);
    }

    for (const folderPath of folderPaths) {
      const existingId = idsByLowerPath.get(folderPath.toLowerCase());
      if (existingId) {
        folderPathToId.set(folderPath, existingId);
        continue;
      }

      const lastSlashIndex = folderPath.lastIndexOf('/');
      const folderName = lastSlashIndex >= 0 ? folderPath.substring(lastSlashIndex + 1) : folderPath;
      const parentPath = lastSlashIndex >= 0 ? folderPath.substring(0, lastSlashIndex) : null;
      const parentFolderId = parentPath !== null ? folderPathToId.get(parentPath) ?? idsByLowerPath.get(parentPath.toLowerCase()) ?? null : null;

      const newFolderId = await sqliteClient.folders.create(folderName, parentFolderId ? { Id: parentFolderId, ManifestId: manifestId } : null);
      folderPathToId.set(folderPath, newFolderId);
      idsByLowerPath.set(folderPath.toLowerCase(), newFolderId);
    }

    return folderPathToId;
  }

  /**
   * Convert the credentials to items and write them into the vault, one transaction per item, then complete the
   * existing items the import enriches.
   * @param sqliteClient - The vault
   * @param credentials - The new credentials to import
   * @param options - Folder mapping, enrichments, attachments and favicons
   * @returns The number of items written or completed
   * @throws {ImportException} With stage Save when an item cannot be written.
   */
  public static async importCredentialsToVault(sqliteClient: ImportTargetClient, credentials: ImportedCredential[], options: VaultImportOptions): Promise<number> {
    const session = createImportWriteSession();
    const enrichments = options.enrichments ?? [];
    const total = credentials.length + enrichments.length;

    // One logo row per kind and source per import session.
    const sessionLogoIds = new Map<string, string | null>();

    for (let index = 0; index < credentials.length; index++) {
      const credential = credentials[index];
      const item = VaultImportWriter.toItem(credential, options);
      try {
        const logoId = await VaultImportWriter.resolveLogoId(sqliteClient, item, credential, options.extractedFavicons, sessionLogoIds);
        await sqliteClient.importExport.insertImportedItem(item, logoId, session);
      } catch (error) {
        // Re-thrown with item context so the UI can show the credential that failed.
        throw new ImportException(ImportStage.Save, `Failed to save item #${index + 1} of ${credentials.length} ("${item.Name ?? ''}"): ${error instanceof Error ? error.message : String(error)}`, error);
      }

      await options.onProgress?.(index + 1, total);
    }

    const personalManifestId = enrichments.length > 0 ? await sqliteClient.getPersonalManifestId() : null;
    for (let index = 0; index < enrichments.length; index++) {
      const { credential, target } = enrichments[index];
      try {
        // Detected again at write time: the item may have changed since the preview.
        const enrichment = target.ManifestId === personalManifestId ? VaultImportWriter.detectEnrichmentFor(await sqliteClient.importExport.getExistingItemData(target), credential) : null;
        if (enrichment && !options.importAttachments) {
          enrichment.Attachments = [];
        }
        if (enrichment && !isEmptyEnrichment(enrichment)) {
          await sqliteClient.importExport.insertItemEnrichment(target, enrichment, session);
        }
      } catch (error) {
        throw new ImportException(ImportStage.Save, `Failed to update existing item "${credential.ServiceName ?? ''}": ${error instanceof Error ? error.message : String(error)}`, error);
      }

      await options.onProgress?.(credentials.length + index + 1, total);
    }

    return total;
  }

  /**
   * Determine what a credential adds to the vault item it matches. Only items of the personal manifest are completed.
   * @param sqliteClient - The vault
   * @param target - The vault item
   * @param credential - The credential
   * @returns The rows the item lacks, or null for an item of another manifest
   */
  public static detectEnrichment(sqliteClient: SqliteClient, target: ItemRef, credential: ImportedCredential): ItemEnrichment | null {
    if (target.ManifestId !== sqliteClient.getPersonalManifestId()) {
      return null;
    }
    return VaultImportWriter.detectEnrichmentFor(sqliteClient.importExport.getExistingItemData(target), credential);
  }

  /**
   * Build the import preview on a client that reads asynchronously: what the matching items hold is read first.
   * @param sqliteClient - The vault
   * @param existingItems - The items already in the vault
   * @param credentials - The parsed credentials
   * @returns The preview
   */
  public static async previewImport(sqliteClient: ImportTargetClient, existingItems: Item[], credentials: ImportedCredential[]): Promise<ImportPreview> {
    const personalManifestId = await sqliteClient.getPersonalManifestId();
    const existingData = new Map<string, ExistingItemData>();
    for (const item of existingItems) {
      if (item.ManifestId === personalManifestId && credentials.some(credential => isDuplicateItem(item, credential))) {
        existingData.set(scopedKey(item.ManifestId, item.Id), await sqliteClient.importExport.getExistingItemData(item));
      }
    }

    return detectAndRemoveDuplicates(existingItems, credentials, (existing, imported) => {
      const data = existingData.get(scopedKey(existing.ManifestId, existing.Id));
      return data ? VaultImportWriter.detectEnrichmentFor(data, imported) : null;
    });
  }

  /**
   * What an imported credential adds to the existing vault item it matches, e.g. a passkey or 2FA code the item lacks.
   * @param existing - What the item holds
   * @param credential - The credential
   * @returns The rows the item lacks
   */
  private static detectEnrichmentFor(existing: ExistingItemData, credential: ImportedCredential): ItemEnrichment {
    return detectItemEnrichment(existing, credential.AliasVaultItem ?? convertToItem(credential, null));
  }

  /**
   * The item a credential is written as: the item an AliasVault export carried, placed in the imported folder, or
   * else an item built from the credential's fields.
   * @param credential - The credential
   * @param options - Folder mapping and attachments
   * @returns The item
   */
  private static toItem(credential: ImportedCredential, options: VaultImportOptions): ItemEntity {
    // Stripping the attachments before conversion keeps them out of the resulting item.
    if (!options.importAttachments) {
      credential.Attachments = null;
    }

    const carried = credential.AliasVaultItem;
    if (!carried) {
      return convertToItem(credential, options.folderNameToId ?? null);
    }

    const folderNameToId = options.folderNameToId;
    return {
      ...carried,
      FolderId: folderNameToId && !isBlank(credential.FolderPath) ? folderNameToId.get(credential.FolderPath) ?? null : null,
      Attachments: options.importAttachments ? carried.Attachments : [],
    };
  }

  /**
   * Resolve the id an item's logo gets in this vault: the logo an AliasVault export carried, with its kind, or else
   * the favicon of its URL.
   * @param sqliteClient - The vault
   * @param item - The item
   * @param credential - The credential the item came from, for embedded favicon bytes
   * @param extractedFavicons - Favicons fetched for the import, by source
   * @param sessionLogoIds - Logo ids already resolved in this import, by kind and source
   * @returns The logo id, or null when the item gets no logo
   */
  private static async resolveLogoId(sqliteClient: ImportTargetClient, item: ItemEntity, credential: ImportedCredential, extractedFavicons: Map<string, Uint8Array>, sessionLogoIds: Map<string, string | null>): Promise<string | null> {
    try {
      const carriedLogo = item.Logo;
      if (carriedLogo) {
        const key = `${carriedLogo.Kind}:${carriedLogo.Source}`;
        if (!sessionLogoIds.has(key)) {
          sessionLogoIds.set(key, await sqliteClient.importExport.resolveCarriedLogo(carriedLogo));
        }
        return sessionLogoIds.get(key) ?? null;
      }

      const urls = item.FieldValues.filter(fv => fv.FieldKey === FieldKey.LoginUrl && !!fv.Value).map(fv => fv.Value!);
      const target = await selectFaviconTarget(urls);
      if (!target) {
        return null;
      }

      const key = `${LogoKinds.Favicon}:${target.source}`;
      if (!sessionLogoIds.has(key)) {
        // Bytes embedded in the import file take precedence; otherwise what was fetched for this source.
        const faviconBytes = credential.FaviconBytes ?? extractedFavicons.get(target.source) ?? null;
        sessionLogoIds.set(key, await sqliteClient.importExport.resolveImportLogo(target.source, faviconBytes));
      }
      return sessionLogoIds.get(key) ?? null;
    } catch (error) {
      // A logo is not critical: log and import the credential without one.
      console.warn(`Failed to process logo for item ${item.Name ?? ''}:`, error);
      return null;
    }
  }
}
