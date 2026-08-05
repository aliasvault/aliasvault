/**
 * SQL query constants for generic base operations.
 */
export class BaseQueries {
  /**
   * SQL fragment resolving the vault's root manifest id, for embedding in a larger statement (an
   * INSERT's VALUES list, a comparison). Use GET_ROOT_MANIFEST_ID to query it standalone.
   */
  public static readonly ROOT_MANIFEST_ID = `(SELECT Id FROM Manifests WHERE IsRoot = 1)`;

  /**
   * The vault's root manifest id, from the Manifests bookkeeping table (written by the codec on every
   * materialize, and by the app at fresh-vault creation).
   */
  public static readonly GET_ROOT_MANIFEST_ID = `
    SELECT Id FROM Manifests WHERE IsRoot = 1 LIMIT 1`;

  /**
   * Register the vault's root manifest row at fresh-vault creation (idempotent). Every later
   * materialize rewrites the table from the manifest set.
   */
  public static readonly INSERT_ROOT_MANIFEST = `
    INSERT OR REPLACE INTO Manifests (Id, IsRoot, AnchorFolderId)
    VALUES (?, 1, NULL)`;

  /**
   * SQL fragment resolving the scope of personal rows: rows stamped with the root manifest's id, plus
   * unstamped legacy rows the codec has not adopted yet (it restamps them at the next sync boundary).
   * @param alias - Table alias to qualify the ManifestId column with, or omitted for an unaliased query
   * @returns The predicate, for interpolation into a WHERE clause
   */
  public static personalScope(alias?: string): string {
    const column = alias ? `${alias}.ManifestId` : 'ManifestId';
    return `(${column} = ${BaseQueries.ROOT_MANIFEST_ID} OR ${column} IS NULL)`;
  }
}
