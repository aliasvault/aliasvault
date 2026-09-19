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
   * The kind and key of an item's logo. Binds [logoId, item manifest]: the item's own manifest wins, and another
   * manifest only answers for an item that was moved and still points at the logo row it came with.
   */
  public static readonly GET_BY_ID = `
    SELECT Id, Kind, Source, Name FROM Logos
    WHERE Id = ? AND IsDeleted = 0
    ORDER BY (ManifestId = ?) DESC, ManifestId
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
}
