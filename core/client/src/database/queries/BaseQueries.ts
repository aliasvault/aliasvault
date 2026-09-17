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
}
