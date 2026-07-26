/**
 * SQL query constants for Logo operations.
 * Centralizes all logo-related queries to avoid duplication.
 */
export class LogoQueries {
  /**
   * Check if a logo exists in the personal scope for a source. Shared-folder rows are deliberately
   * excluded: adopting another manifest's row here would drag its icon into the personal cache.
   */
  public static readonly GET_ID_FOR_SOURCE = `
    SELECT Id FROM Logos
    WHERE Source = ? AND SharedFolderId IS NULL AND IsDeleted = 0
    LIMIT 1`;

  /**
   * The source of an existing logo, whatever scope it belongs to. Used to tell whether an item's logo
   * still matches its URL, so an edit doesn't re-resolve (and thereby re-scope) an unchanged icon.
   */
  public static readonly GET_SOURCE_FOR_ID = `
    SELECT Source FROM Logos
    WHERE Id = ?
    LIMIT 1`;

  /**
   * Insert or update a logo.
   */
  public static readonly UPSERT = `
    INSERT INTO Logos (Id, Source, SharedFolderId, FileData, CreatedAt, UpdatedAt, IsDeleted)
    VALUES (?, ?, NULL, ?, ?, ?, 0)
    ON CONFLICT(Id) DO UPDATE SET
      FileData = excluded.FileData,
      UpdatedAt = excluded.UpdatedAt,
      IsDeleted = 0`;
}
