/**
 * SQL query constants for item logo operations.
 */
export class LogoQueries {
  /**
   * The logo of a given kind and key within one manifest.
   */
  public static readonly GET_ID_FOR_KEY = `
    SELECT Id FROM Logos
    WHERE ManifestId = ? AND Kind = ? AND Source = ? AND IsDeleted = 0
    LIMIT 1`;

  /**
   * The id of a logo for this kind and key in ANY manifest, used only to answer "does this vault already
   * hold this image somewhere" before paying for a network fetch.
   */
  public static readonly FIND_ANY_ID_FOR_KEY = `
    SELECT Id FROM Logos
    WHERE Kind = ? AND Source = ? AND IsDeleted = 0
    LIMIT 1`;

  /**
   * The best row to copy from when a manifest needs a logo it does not have but the vault does.
   */
  public static readonly GET_BEST_FOR_KEY = `
    SELECT FileData, MimeType, Name FROM Logos
    WHERE Kind = ? AND Source = ? AND IsDeleted = 0
    ORDER BY (FileData IS NOT NULL AND LENGTH(FileData) > 0) DESC, UpdatedAt DESC
    LIMIT 1`;

  /**
   * The kind and key of an item's logo.
   */
  public static readonly GET_BY_ID = `
    SELECT Id, Kind, Source, Name FROM Logos
    WHERE Id = ? AND ManifestId = ? AND IsDeleted = 0`;

  /**
   * Get all items with the kind and key of their current logo.
   */
  public static readonly GET_ITEMS_WITH_LOGO_KIND = `
    SELECT i.Id, l.Kind AS LogoKind, l.Source AS LogoSource, i.LogoId
    FROM Items i
    LEFT JOIN Logos l ON l.ManifestId = i.ManifestId AND l.Id = i.LogoId AND l.IsDeleted = 0
    WHERE i.ManifestId = ? AND i.IsDeleted = 0 AND i.DeletedAt IS NULL`;

  /**
   * The values of one field key for every item of one manifest, in display order.
   */
  public static readonly GET_FIELD_VALUES_FOR_MANIFEST = `
    SELECT ItemId, Value FROM FieldValues
    WHERE ManifestId = ? AND FieldKey = ? AND IsDeleted = 0 AND Value IS NOT NULL
    ORDER BY ItemId, Weight, ValueIndex`;

  /**
   * Point an item at another logo, or at none.
   */
  public static readonly SET_ITEM_LOGO = `
    UPDATE Items SET LogoId = ?, UpdatedAt = ?
    WHERE Id = ? AND ManifestId = ?`;

  /**
   * Unlink every item of one manifest from its favicon. The orphaned favicon rows are then pruned before the next push.
   */
  public static readonly UNLINK_FAVICONS = `
    UPDATE Items SET LogoId = NULL, UpdatedAt = ?
    WHERE ManifestId = ? AND IsDeleted = 0
      AND LogoId IN (SELECT Id FROM Logos WHERE ManifestId = ? AND Kind = ?)`;

  /**
   * Insert or update a logo.
   */
  public static readonly UPSERT = `
    INSERT INTO Logos (Id, Kind, Source, ManifestId, FileData, MimeType, Name, CreatedAt, UpdatedAt, IsDeleted)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(ManifestId, Id) DO UPDATE SET
      FileData = excluded.FileData,
      MimeType = excluded.MimeType,
      Name = COALESCE(excluded.Name, Logos.Name),
      UpdatedAt = excluded.UpdatedAt,
      IsDeleted = 0`;
}
