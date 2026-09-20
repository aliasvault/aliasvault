import type { Folder } from '../database/repositories/FolderRepository';
import type { SqliteClient } from '../database/SqliteClient';

/**
 * How this client presents a vault that is made of several manifests. The local SQLite vault working copy
 * holds the personal manifest plus every shared manifest this account holds a key for. How the different
 * manifests are presented to the user is purely a client-side choice. Currently two modes are in scope:
 * - `subfolder`: every shared manifest shows up as a top-level folder in the one vault view, so items from all
 *   manifests are browsed, searched and moved together.
 * - `switcher`: the UI scopes itself to one manifest at a time and the user switches vaults, so a shared manifest
 *   never appears in the personal folder tree. TODO: add this mode (not offered to users (yet)).
 */
export type MultiManifestRenderingMode = 'subfolder' | 'switcher';

/**
 * A shared manifest this vault holds, with its name. The server keeps the name encrypted with the manifest's own
 * key; every sync fetches it into the local `Manifests` table, which is read-only to the client.
 */
export type SharedManifest = {
  ManifestId: string;
  Name: string | null;
};

/**
 * The presentation policy for a multi-manifest vault, as one swappable unit. The repositories pass every folder and
 * every item folder reference through it, in both directions, so the rest of the client only ever sees the rendered
 * shape and the vault only ever holds the stored one.
 */
export type MultiManifestRenderer = {
  /**
   * The mode this renderer implements.
   */
  readonly mode: MultiManifestRenderingMode;

  /**
   * Whether a folder is virtual: drawn by this client rather than stored in the vault, and so not the user's to
   * rename, move or delete. In `subfolder` mode the folder a shared manifest is rendered as is the virtual one.
   * @param folder - The folder to classify
   */
  isVirtualFolder(folder: Pick<Folder, 'Id' | 'ManifestId'>): boolean;

  /**
   * The folders as this mode presents them.
   * @param stored - The folder rows of the vault
   * @param sharedManifests - The shared manifests the vault holds
   */
  folders(stored: Folder[], sharedManifests: SharedManifest[]): Folder[];

  /**
   * The folder a row is presented in, given the folder the vault stores for it.
   * @param storedFolderId - The stored `FolderId` or `ParentFolderId`
   * @param manifestId - The manifest the row lives in
   * @param personalManifestId - The personal manifest
   */
  renderedFolderId(storedFolderId: string | null, manifestId: string, personalManifestId: string | null): string | null;

  /**
   * The folder the vault stores for a row, given the folder it is presented in.
   * @param renderedFolderId - The presented `FolderId` or `ParentFolderId`
   * @param manifestId - The manifest the row lives in
   */
  storedFolderId(renderedFolderId: string | null | undefined, manifestId: string): string | null;

  /**
   * What each shared manifest is called, keyed by lower-cased manifest id.
   * @param sqliteClient - The open local vault
   */
  displayNames(sqliteClient: SqliteClient): Record<string, string>;
};

/**
 * Whether two ids name the same thing.
 * @param a - One id
 * @param b - The other id
 */
function sameId(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a) && Boolean(b) && String(a).toLowerCase() === String(b).toLowerCase();
}

/**
 * Renders every shared manifest as a top-level folder that exists only in this client: its id is the manifest id,
 * its name is the manifest's name, and everything the manifest stores at its top level is presented inside it.
 */
const subfolderRendering: MultiManifestRenderer = {
  mode: 'subfolder',

  /**
   * A folder carrying its own manifest's id is the one that manifest is rendered as, which this mode never stores.
   * @param folder - The folder to classify
   */
  isVirtualFolder(folder: Pick<Folder, 'Id' | 'ManifestId'>): boolean {
    return sameId(folder.Id, folder.ManifestId);
  },

  /**
   * One folder per shared manifest, with the manifest's top-level folders moved inside it.
   * @param stored - The folder rows of the vault
   * @param sharedManifests - The shared manifests the vault holds
   */
  folders(stored: Folder[], sharedManifests: SharedManifest[]): Folder[] {
    const shared = new Set(sharedManifests.map(manifest => manifest.ManifestId.toLowerCase()));

    // A vault written by an earlier build can still store the folder; it then stands in for the rendered one.
    const storedRoots = new Set(stored.filter(folder => subfolderRendering.isVirtualFolder(folder)).map(folder => folder.ManifestId.toLowerCase()));

    const roots = sharedManifests
      .filter(manifest => !storedRoots.has(manifest.ManifestId.toLowerCase()))
      .map(manifest => ({ Id: manifest.ManifestId.toLowerCase(), Name: manifest.Name ?? '', ParentFolderId: null, Weight: 0, ManifestId: manifest.ManifestId }));

    const nested = stored.map(folder => (folder.ParentFolderId === null && shared.has(String(folder.ManifestId).toLowerCase()) && !subfolderRendering.isVirtualFolder(folder)
      ? { ...folder, ParentFolderId: String(folder.ManifestId).toLowerCase() }
      : folder));

    return [...roots, ...nested];
  },

  /**
   * A shared manifest's top level is presented as the inside of its folder.
   * @param storedFolderId - The stored `FolderId` or `ParentFolderId`
   * @param manifestId - The manifest the row lives in
   * @param personalManifestId - The personal manifest
   */
  renderedFolderId(storedFolderId: string | null, manifestId: string, personalManifestId: string | null): string | null {
    if (storedFolderId || !manifestId || !personalManifestId || sameId(manifestId, personalManifestId)) {
      return storedFolderId;
    }
    return manifestId.toLowerCase();
  },

  /**
   * The folder a shared manifest is rendered as is not stored, so a row inside it is stored at the top level.
   * @param renderedFolderId - The presented `FolderId` or `ParentFolderId`
   * @param manifestId - The manifest the row lives in
   */
  storedFolderId(renderedFolderId: string | null | undefined, manifestId: string): string | null {
    return !renderedFolderId || sameId(renderedFolderId, manifestId) ? null : renderedFolderId;
  },

  /**
   * The name of a manifest as the last sync fetched it.
   * @param sqliteClient - The open local vault
   */
  displayNames(sqliteClient: SqliteClient): Record<string, string> {
    // A vault whose schema predates the table holds nothing but the personal manifest, so it names none.
    if (!sqliteClient.hasColumn('Manifests', 'Name')) {
      return {};
    }

    const rows = sqliteClient.executeQuery<{ Id: string; Name: string }>('SELECT Id, Name FROM Manifests WHERE Name IS NOT NULL');
    return Object.fromEntries(rows.map(row => [row.Id.toLowerCase(), row.Name]));
  },
};

/**
 * The rendering mode this build ships. Every caller goes through this, so the mode is decided here and nowhere else.
 */
export const multiManifestRendering: MultiManifestRenderer = subfolderRendering;

export default multiManifestRendering;
