/**
 * SQL query constants for per-item usage statistics.
 *
 * A stats row is addressed by `(ManifestId, Id)` where `Id` *is* the item's id, so recording a use is an
 * upsert against the item itself rather than a lookup through a foreign key.
 */
export class ItemStatsQueries {
  /**
   * Whether the item exists.
   */
  public static readonly ITEM_EXISTS = `
    SELECT 1 AS Found
    FROM Items
    WHERE Id = ? AND ManifestId = ?`;

  /**
   * Create the stats row for an item on its first recorded use.
   */
  public static readonly INSERT_ROW = `
    INSERT OR IGNORE INTO ItemStats (
      ManifestId, Id, LastUsedAt, UseCount, LastAutofilledAt, AutofillCount,
      LastCopiedAt, CopyCount, LastPasskeyAuthAt, PasskeyAuthCount, CreatedAt, UpdatedAt, IsDeleted
    )
    VALUES (?, ?, NULL, 0, NULL, 0, NULL, 0, NULL, 0, ?, ?, 0)`;

  /**
   * Record one use of an item, bumping the aggregate and the per-action pair for `action`.
   *
   * The per-action column names are interpolated by {@link forAction} from a closed set, never from
   * caller input. `IsDeleted` is cleared because a use resurrects a row the pruner tombstoned when the
   * item was last emptied out of the trash.
   * @param lastColumn - The per-action timestamp column
   * @param countColumn - The per-action counter column
   * @returns The UPDATE statement, taking (now, now, ManifestId, Id)
   */
  public static forAction(lastColumn: string, countColumn: string): string {
    return `
      UPDATE ItemStats
      SET LastUsedAt = ?,
          UseCount = UseCount + 1,
          ${lastColumn} = ?,
          ${countColumn} = ${countColumn} + 1,
          UpdatedAt = ?,
          IsDeleted = 0
      WHERE ManifestId = ? AND Id = ?`;
  }
}
