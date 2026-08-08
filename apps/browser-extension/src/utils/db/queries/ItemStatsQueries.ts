/**
 * SQL query constants for per-item usage statistics.
 *
 * A stats row is addressed by `(ManifestId, Id)` where `Id` *is* the item's id, so recording a use is an
 * upsert against the item itself rather than a lookup through a foreign key.
 */
export class ItemStatsQueries {
  /**
   * The manifest an item belongs to.
   */
  public static readonly GET_ITEM_MANIFEST = `
    SELECT ManifestId
    FROM Items
    WHERE Id = ?
    LIMIT 1`;

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

  /**
   * Read one item's statistics.
   */
  public static readonly GET_FOR_ITEM = `
    SELECT LastUsedAt, UseCount, LastAutofilledAt, AutofillCount, LastCopiedAt, CopyCount, LastPasskeyAuthAt, PasskeyAuthCount
    FROM ItemStats
    WHERE ManifestId = ? AND Id = ? AND IsDeleted = 0`;

  /**
   * Read the last-used timestamp of every item that has one, newest first.
   *
   * Joined on both halves of the key: an item id alone is ambiguous across manifests, which is exactly
   * what the composite key exists to prevent.
   */
  public static readonly GET_LAST_USED_ALL = `
    SELECT s.ManifestId, s.Id, s.LastUsedAt, s.UseCount
    FROM ItemStats s
    INNER JOIN Items i ON i.Id = s.Id AND i.ManifestId = s.ManifestId
    WHERE s.IsDeleted = 0 AND s.LastUsedAt IS NOT NULL AND i.IsDeleted = 0
    ORDER BY s.LastUsedAt DESC`;
}
