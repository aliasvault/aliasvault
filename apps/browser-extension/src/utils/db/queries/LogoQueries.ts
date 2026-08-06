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
   * The kind and key of an existing logo.
   */
  public static readonly GET_BY_ID = `
    SELECT Id, Kind, Source, Name FROM Logos
    WHERE Id = ? AND IsDeleted = 0
    LIMIT 1`;

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

  /**
   * One manifest's library of uploaded logos, newest first. Favicons are excluded.
   */
  public static readonly LIST_CUSTOM = `
    SELECT Id, Kind, Source, Name, FileData FROM Logos
    WHERE ManifestId = ? AND Kind = 'custom' AND IsDeleted = 0
    ORDER BY UpdatedAt DESC`;

  /**
   * Every item whose logo lives outside the item's own manifest, with the kind and key needed to bring a
   * copy in.
   */
  public static readonly FIND_ITEMS_WITH_FOREIGN_LOGO = `
    SELECT i.Id, i.ManifestId, origin.Kind, origin.Source
    FROM Items i
    INNER JOIN Logos origin ON origin.Id = i.LogoId
    LEFT JOIN Logos own ON own.Id = i.LogoId AND own.ManifestId = i.ManifestId
    WHERE i.LogoId IS NOT NULL AND own.Id IS NULL AND i.IsDeleted = 0`;

  /**
   * Point an item at the copy of its logo that lives in its own manifest.
   */
  public static readonly REPOINT_ITEM_LOGO = `
    UPDATE Items SET LogoId = ? WHERE Id = ? AND ManifestId = ?`;

  /**
   * Soft-delete an uploaded logo, removing it from the library.
   */
  public static readonly SOFT_DELETE = `
    UPDATE Logos SET IsDeleted = 1, UpdatedAt = ? WHERE Id = ?`;
}
