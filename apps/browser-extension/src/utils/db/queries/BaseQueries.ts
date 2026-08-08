/**
 * SQL query constants for generic base operations.
 */
export class BaseQueries {
  /**
   * SQL fragment resolving the manifest a row placed in the folder bound to its first `?` (possibly
   * NULL) belongs to: that folder's manifest, or the manifest bound to its second `?` when the row sits
   * outside any folder.
   */
  public static readonly MANIFEST_OF_FOLDER = 'COALESCE((SELECT ManifestId FROM Folders WHERE Id = ?), ?)';

  /**
   * {@link MANIFEST_OF_FOLDER} as a standalone query, for a caller that has to know the manifest a row is
   * about to be stamped with *before* writing it.
   */
  public static readonly GET_MANIFEST_OF_FOLDER = `SELECT ${BaseQueries.MANIFEST_OF_FOLDER} AS ManifestId`;

  /**
   * SQL fragment resolving the manifest of the item whose id is bound to its first `?`. Every row hanging
   * off an item (field values, TOTP codes, attachments, tags, history) is keyed by (ManifestId, Id) and
   * points at its item by the composite (ManifestId, ItemId), so it has to be stamped with the item's
   * own manifest.
   */
  public static readonly MANIFEST_OF_ITEM = 'COALESCE((SELECT ManifestId FROM Items WHERE Id = ?), ?)';

  /**
   * SQL fragment joining a row to another manifest-scoped table on both halves of the key. A join on
   * the id alone would let a row resolve against a same-id row in a manifest it has nothing to do
   * with, which is precisely what (ManifestId, Id) exists to prevent.
   * @param left - Alias of the referencing table
   * @param right - Alias of the referenced table
   * @returns The predicate, for appending to a JOIN's ON clause
   */
  public static sameManifest(left: string, right: string): string {
    return `${left}.ManifestId = ${right}.ManifestId`;
  }

  /**
   * Re-stamp a folder's whole subtree with `?` (a manifest id).
   * Used when a folder is shared (its subtree joins that manifest's namespace) and when the share is
   * removed (the subtree returns to the personal manifest).
   */
  public static readonly RESTAMP_SUBTREE_FOLDERS = `
    UPDATE Folders SET ManifestId = ?
    WHERE Id IN (
      WITH RECURSIVE subtree(Id) AS (
        SELECT Id FROM Folders WHERE Id = ?
        UNION ALL
        SELECT f.Id FROM Folders f INNER JOIN subtree s ON f.ParentFolderId = s.Id
      )
      SELECT Id FROM subtree
    )`;

  /** Companion of {@link RESTAMP_SUBTREE_FOLDERS} for the items inside that subtree. */
  public static readonly RESTAMP_SUBTREE_ITEMS = `
    UPDATE Items SET ManifestId = ?
    WHERE FolderId IN (
      WITH RECURSIVE subtree(Id) AS (
        SELECT Id FROM Folders WHERE Id = ?
        UNION ALL
        SELECT f.Id FROM Folders f INNER JOIN subtree s ON f.ParentFolderId = s.Id
      )
      SELECT Id FROM subtree
    )`;

  /**
   * The tables whose rows hang off an item and are therefore stamped with the item's manifest.
   */
  private static readonly ITEM_CHILD_TABLES = ['FieldValues', 'FieldHistories', 'ItemTags', 'Attachments', 'Passkeys', 'TotpCodes'];

  /**
   * Pull every item-scoped row's `ManifestId` back into line with the item it hangs off.
   */
  public static readonly RESYNC_ITEM_CHILD_MANIFESTS: readonly string[] = BaseQueries.ITEM_CHILD_TABLES.map(
    (table) => `
    UPDATE ${table}
    SET ManifestId = (SELECT i.ManifestId FROM Items i WHERE i.Id = ${table}.ItemId)
    WHERE ManifestId IS NOT (SELECT i.ManifestId FROM Items i WHERE i.Id = ${table}.ItemId)
      AND EXISTS (SELECT 1 FROM Items i WHERE i.Id = ${table}.ItemId)`,
  );
}
