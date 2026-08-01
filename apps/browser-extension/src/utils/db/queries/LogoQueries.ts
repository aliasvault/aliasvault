/**
 * SQL query constants for item logo operations.
 *
 * One `Logos` row is one logo, whatever its origin: `Kind` says whether it was fetched from a URL,
 * picked from the built-in catalog, or uploaded, and `Source` is that kind's natural key. Every query
 * here is therefore keyed on (Kind, Source) rather than Source alone.
 */
export class LogoQueries {
  /**
   * SQL fragment resolving the personal scope: rows stamped with the root manifest's id (from the
   * Manifests bookkeeping table), plus unstamped legacy rows the codec has not adopted yet.
   */
  private static readonly PERSONAL_SCOPE = `(ManifestId = (SELECT Id FROM Manifests WHERE IsRoot = 1) OR ManifestId IS NULL)`;

  /**
   * The logo of a given kind and key in the personal scope. Shared-manifest rows are deliberately
   * excluded: adopting another manifest's row here would drag its logo into the personal vault.
   */
  public static readonly GET_ID_FOR_KEY = `
    SELECT Id FROM Logos
    WHERE Kind = ? AND Source = ? AND ${LogoQueries.PERSONAL_SCOPE} AND IsDeleted = 0
    LIMIT 1`;

  /**
   * The kind and key of an existing logo, whatever scope it belongs to. Used to tell whether an item's
   * logo still matches its URL, so an edit doesn't re-resolve (and thereby re-scope) an unchanged logo.
   */
  public static readonly GET_BY_ID = `
    SELECT Id, Kind, Source, Name FROM Logos
    WHERE Id = ? AND IsDeleted = 0
    LIMIT 1`;

  /**
   * Insert or update a logo. Re-inserting a logo that exists refreshes its bytes and revives it if
   * the user had deleted it, which is what makes re-uploading a previously removed image work.
   */
  public static readonly UPSERT = `
    INSERT INTO Logos (Id, Kind, Source, ManifestId, FileData, MimeType, Name, CreatedAt, UpdatedAt, IsDeleted)
    VALUES (?, ?, ?, (SELECT Id FROM Manifests WHERE IsRoot = 1), ?, ?, ?, ?, ?, 0)
    ON CONFLICT(Id) DO UPDATE SET
      FileData = excluded.FileData,
      MimeType = excluded.MimeType,
      Name = COALESCE(excluded.Name, Logos.Name),
      UpdatedAt = excluded.UpdatedAt,
      IsDeleted = 0`;

  /**
   * The user's personal library of uploaded logos, newest first. Favicons are excluded: those are a
   * cache keyed on domains, not images the user chose and would want to pick again.
   */
  public static readonly LIST_CUSTOM = `
    SELECT Id, Kind, Source, Name, FileData FROM Logos
    WHERE Kind = 'custom' AND ${LogoQueries.PERSONAL_SCOPE} AND IsDeleted = 0
    ORDER BY UpdatedAt DESC`;

  /**
   * Soft-delete an uploaded logo, removing it from the library. Items still pointing at it fall back
   * to their placeholder; the pruner reclaims the bytes on the next run.
   */
  public static readonly SOFT_DELETE = `
    UPDATE Logos SET IsDeleted = 1, UpdatedAt = ? WHERE Id = ?`;
}
