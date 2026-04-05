/**
 * SQL query constants for Logo operations.
 * Centralizes all logo-related queries to avoid duplication.
 */
export class LogoQueries {
  /**
   * Check if logo exists for source.
   */
  public static readonly GET_ID_FOR_SOURCE = `
    SELECT Id FROM Logos
    WHERE Source = ? AND IsDeleted = 0
    LIMIT 1`;

  /**
   * Insert new logo.
   */
  public static readonly INSERT = `
    INSERT INTO Logos (Id, Source, FileData, CreatedAt, UpdatedAt, IsDeleted)
    VALUES (?, ?, ?, ?, ?, ?)`;

  /**
   * Count items using a logo.
   */
  public static readonly COUNT_USAGE = `
    SELECT COUNT(*) as count FROM Items
    WHERE LogoId = ? AND IsDeleted = 0`;

  /**
   * Hard delete logo.
   */
  public static readonly HARD_DELETE = `
    DELETE FROM Logos WHERE Id = ?`;
}
