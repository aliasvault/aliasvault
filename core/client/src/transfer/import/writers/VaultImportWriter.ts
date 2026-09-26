import { FieldKey } from '@aliasvault/models/vault';

import { selectFaviconTarget } from '../../../rust/RustCore';
import { buildFolderPath } from '../../shared/FolderPaths';
import { ImportException, ImportStage } from '../models/ImportException';

import { convertToItems } from './ItemConverter';

import type { SqliteClient } from '../../../database/SqliteClient';
import type { ItemEntity } from '../../shared/VaultEntities';
import type { ImportedCredential } from '../models/ImportedCredential';

/**
 * How an import is written.
 */
export type VaultImportOptions = {
  /** Folder paths to the folder ids they were created as; null when folders are not imported. */
  folderNameToId?: Map<string, string> | null;
  /** Whether attachments are written; false strips them before conversion. */
  importAttachments: boolean;
  /** Favicons fetched for the import, keyed by their Logos.Source (domain). */
  extractedFavicons: Map<string, Uint8Array>;
  /** Progress callback with the number of items saved so far and the total. */
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
    // Stripping the attachments before conversion keeps them out of the resulting items.
    if (!options.importAttachments) {
      for (const credential of credentials) {
        credential.Attachments = null;
      }
    }

    const items = convertToItems(credentials, options.folderNameToId);

    // One logo row per source per import session.
    const sessionLogoIds = new Map<string, string | null>();

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      try {
        await VaultImportWriter.processSingleItem(sqliteClient, item, credentials, options.extractedFavicons, sessionLogoIds);
      } catch (error) {
        // Re-thrown with item context so the UI can show the credential that failed.
        throw new ImportException(ImportStage.Save, `Failed to save item #${index + 1} of ${items.length} ("${item.Name ?? ''}"): ${error instanceof Error ? error.message : String(error)}`, error);
      }

      await options.onProgress?.(index + 1, items.length);
    }

    return items.length;
  }

  /**
   * Resolve an item's logo and insert it.
   * @param sqliteClient - The vault
   * @param item - The item
   * @param credentials - The credentials the item came from, for embedded logo bytes
   * @param extractedFavicons - Favicons fetched for the import, by source
   * @param sessionLogoIds - Logo ids already resolved in this import, by source
   */
  private static async processSingleItem(sqliteClient: SqliteClient, item: ItemEntity, credentials: ImportedCredential[], extractedFavicons: Map<string, Uint8Array>, sessionLogoIds: Map<string, string | null>): Promise<void> {
    const importedCredential = credentials.find(c => c.ServiceName === item.Name);
    const urls = item.FieldValues.filter(fv => fv.FieldKey === FieldKey.LoginUrl && !!fv.Value).map(fv => fv.Value!);
    const target = await selectFaviconTarget(urls);

    if (target) {
      // Bytes embedded in the import file take precedence; otherwise what was fetched for this source.
      const faviconBytes = importedCredential?.FaviconBytes ?? extractedFavicons.get(target.source) ?? null;
      try {
        if (sessionLogoIds.has(target.source)) {
          item.LogoId = sessionLogoIds.get(target.source) ?? null;
        } else {
          item.LogoId = await sqliteClient.importExport.resolveImportLogo(target.source, faviconBytes);
          sessionLogoIds.set(target.source, item.LogoId);
        }
      } catch (error) {
        // A favicon is not critical: log and import the credential without one.
        console.warn(`Failed to process favicon for item ${item.Name ?? ''}:`, error);
        item.LogoId = null;
      }
    }

    await sqliteClient.importExport.insertImportedItem(item);
  }
}
