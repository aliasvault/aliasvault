import { FieldKey, LogoKinds } from '@aliasvault/models/vault';

import { createImportWriteSession } from '../../../database/repositories/ImportExportRepository';
import { selectFaviconTarget } from '../../../rust/RustCore';
import { buildFolderPath } from '../../shared/FolderPaths';
import { isBlank } from '../../shared/StringUtils';
import { ImportException, ImportStage } from '../models/ImportException';

import { convertToItem } from './ItemConverter';

import type { SqliteClient } from '../../../database/SqliteClient';
import type { ItemEntity } from '../../shared/VaultEntities';
import type { ImportedCredential } from '../models/ImportedCredential';

/**
 * How an import is written.
 */
export type VaultImportOptions = {
  folderNameToId?: Map<string, string> | null;
  importAttachments: boolean;
  extractedFavicons: Map<string, Uint8Array>;
  onProgress?: (saved: number, total: number) => Promise<void> | void;
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
  public static async createOrGetFolders(sqliteClient: SqliteClient, folderPaths: string[]): Promise<Map<string, string>> {
    const folderPathToId = new Map<string, string>();
    const idsByLowerPath = new Map<string, string>();

    // Imported items land in the personal manifest, so only its folders can hold them.
    const manifestId = sqliteClient.getPersonalManifestId();
    if (!manifestId) {
      throw new Error('VaultImportWriter: this client has no personal manifest recorded yet; sync once before importing.');
    }

    const existingFolders = sqliteClient.folders.getAll().filter(folder => folder.ManifestId === manifestId);
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
   * Convert the credentials to items and write them into the vault, one transaction per item.
   * @param sqliteClient - The vault
   * @param credentials - The credentials to import
   * @param options - Folder mapping, attachments and favicons
   * @returns The number of items written
   * @throws {ImportException} With stage Save when an item cannot be written.
   */
  public static async importCredentialsToVault(sqliteClient: SqliteClient, credentials: ImportedCredential[], options: VaultImportOptions): Promise<number> {
    const session = createImportWriteSession();

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

      await options.onProgress?.(index + 1, credentials.length);
    }

    return credentials.length;
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
  private static async resolveLogoId(sqliteClient: SqliteClient, item: ItemEntity, credential: ImportedCredential, extractedFavicons: Map<string, Uint8Array>, sessionLogoIds: Map<string, string | null>): Promise<string | null> {
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
