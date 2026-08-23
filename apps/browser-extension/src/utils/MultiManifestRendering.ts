import type { Folder } from '@/utils/db/repositories/FolderRepository';
import { devWarn } from '@/utils/devLogger/DevLogger';
import type { SqliteClient } from '@/utils/SqliteClient';

import { t } from '@/i18n/StandaloneI18n';

/**
 * How this client presents a vault that is made of several manifests. The local SQLite vault working copy
 * holds the personal manifest plus every shared manifest this account holds a key for. How the different
 * manifests are presented to the user is purely a client-side choice. Currently two modes are in scope:
 * - `subfolder`: every shared manifest shows up as a top-level folder in the one vault view, so items from all
 *   manifests are browsed, searched and moved together. This is the mode that is built.
 * - `switcher`: the UI scopes itself to one manifest at a time and the user switches vaults, so a shared manifest
 *   never appears in the personal folder tree. TODO: add this mode (not offered to users (yet)).
 */
export type MultiManifestRenderingMode = 'subfolder' | 'switcher';

/**
 * Rendering policy for a shared manifest.
 */
export type RenderableManifest = {
  manifestId: string;
  name?: string | null;
  canAdminister?: boolean;
};

/**
 * The presentation policy for a multi-manifest vault, as one swappable unit.
 */
export type MultiManifestRenderer = {
  /**
   * The mode this renderer implements.
   */
  readonly mode: MultiManifestRenderingMode;

  /**
   * Whether a folder is one that a shared manifest is rendered as, and so is not the user's to delete or rehome.
   * @param folder - The folder to classify
   */
  isManifestRoot(folder: Pick<Folder, 'Id' | 'ManifestId'>): boolean;

  /**
   * Give a shared manifest whatever local presence this mode renders it as.
   * @param sqliteClient - The open local vault (caller must run this inside a vault mutation so it is saved)
   * @param manifestId - The shared manifest to render
   * @param name - The manifest's own name
   */
  render(sqliteClient: SqliteClient, manifestId: string, name: string): Promise<void>;

  /**
   * Restore that presence for every administered manifest that is missing it.
   * @param sqliteClient - The open local vault
   * @param manifests - The shared manifests this session holds a key for
   * @returns Whether the vault was mutated
   */
  reconcile(sqliteClient: SqliteClient, manifests: RenderableManifest[]): Promise<boolean>;

  /**
   * What each shared manifest is called, keyed by lower-cased manifest id. This is the authority for the name that
   * gets pushed into the manifest, so a rename in the UI follows the vault.
   * @param sqliteClient - The open local vault
   */
  displayNames(sqliteClient: SqliteClient): Record<string, string>;
};

/**
 * What a shared manifest is called when this client has no name for it yet.
 */
async function defaultSharedVaultName(): Promise<string> {
  return t('sharing.family.unnamedVault');
}

/**
 * Renders every shared manifest as a top-level folder whose id is the manifest id, which is what makes the folder
 * findable from a manifest id alone and what lets its subtree be re-stamped in one statement.
 */
const subfolderRendering: MultiManifestRenderer = {
  mode: 'subfolder',

  /**
   * A folder carrying its own manifest's id is the one that manifest is rendered as.
   * @param folder - The folder to classify
   */
  isManifestRoot(folder: Pick<Folder, 'Id' | 'ManifestId'>): boolean {
    return Boolean(folder.ManifestId) && folder.Id.toUpperCase() === String(folder.ManifestId).toUpperCase();
  },

  /**
   * Create the manifest's folder and pull everything under it into the manifest.
   * @param sqliteClient - The open local vault
   * @param manifestId - The shared manifest to render
   * @param name - The folder name, which is the vault's name
   */
  async render(sqliteClient: SqliteClient, manifestId: string, name: string): Promise<void> {
    const folderId = manifestId.toUpperCase();
    await sqliteClient.folders.create(name, null, folderId);
    await sqliteClient.folders.restampSubtree(folderId, manifestId);
  },

  /**
   * Re-create the folder of any administered manifest that has none.
   * @param sqliteClient - The open local vault
   * @param manifests - The shared manifests this session holds a key for
   * @returns Whether the vault was mutated
   */
  async reconcile(sqliteClient: SqliteClient, manifests: RenderableManifest[]): Promise<boolean> {
    let mutated = false;

    for (const manifest of manifests) {
      if (!manifest.canAdminister) {
        // A member waiting for the administrator's first push has nothing to render yet.
        continue;
      }

      const rendered = sqliteClient.executeQuery<{ Id: string }>('SELECT Id FROM Folders WHERE ManifestId = ? AND IsDeleted = 0 AND ParentFolderId IS NULL', [manifest.manifestId]);
      if (rendered.length > 0) {
        continue;
      }

      await this.render(sqliteClient, manifest.manifestId, manifest.name ?? await defaultSharedVaultName());
      devWarn(`[Sharing] Shared manifest ${manifest.manifestId} had no folder; recreated it.`);
      mutated = true;
    }

    return mutated;
  },

  /**
   * The name of a shared manifest is the name of the folder it is rendered as.
   * @param sqliteClient - The open local vault
   */
  displayNames(sqliteClient: SqliteClient): Record<string, string> {
    /*
     * A vault whose schema predates the manifest stamp holds nothing but the personal manifest, so it names none.
     * This runs while migrating such a vault onto the current schema, where the column is not there yet.
     */
    if (!sqliteClient.hasColumn('Folders', 'ManifestId')) {
      return {};
    }

    const roots = sqliteClient.executeQuery<{ ManifestId: string; Name: string }>('SELECT ManifestId, Name FROM Folders WHERE IsDeleted = 0 AND ManifestId IS NOT NULL AND UPPER(Id) = UPPER(ManifestId)');
    return Object.fromEntries(roots.map(root => [root.ManifestId.toLowerCase(), root.Name]));
  },
};

/**
 * The rendering mode this build ships. Every caller goes through this, so the mode is decided here and nowhere else.
 */
export const multiManifestRendering: MultiManifestRenderer = subfolderRendering;

export default multiManifestRendering;
