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
}
