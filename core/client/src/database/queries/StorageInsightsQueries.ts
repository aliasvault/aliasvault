/**
 * SQL query constants for the storage insights of the local vault. Trashed items count (they are still stored until
 * purged), tombstoned rows do not.
 */
export class StorageInsightsQueries {
  /**
   * Item, attachment and logo counts.
   */
  public static readonly GET_COUNTS = `
    SELECT
      (SELECT COUNT(*) FROM Items WHERE IsDeleted = 0) AS ItemCount,
      (SELECT COUNT(*) FROM Items i WHERE i.IsDeleted = 0
        AND EXISTS (SELECT 1 FROM Attachments a WHERE a.ItemId = i.Id AND a.ManifestId = i.ManifestId AND a.IsDeleted = 0)) AS ItemsWithAttachments,
      (SELECT COUNT(*) FROM Items i WHERE i.IsDeleted = 0 AND i.LogoId IS NOT NULL) AS ItemsWithLogos,
      (SELECT COUNT(*) FROM Attachments a JOIN Items i ON i.Id = a.ItemId AND i.ManifestId = a.ManifestId
        WHERE a.IsDeleted = 0 AND i.IsDeleted = 0) AS AttachmentCount,
      (SELECT COUNT(*) FROM Logos WHERE IsDeleted = 0 AND (FileData IS NOT NULL OR FileDataHash IS NOT NULL)) AS LogoCount`;

  /**
   * The largest attachments with the item they belong to.
   */
  public static readonly GET_LARGEST_ATTACHMENTS = `
    SELECT a.Id, a.Filename, LENGTH(a.Blob) AS SizeBytes, a.ItemId, a.ManifestId, i.Name AS ItemName, a.CreatedAt
    FROM Attachments a
    JOIN Items i ON i.Id = a.ItemId AND i.ManifestId = a.ManifestId
    WHERE a.IsDeleted = 0 AND i.IsDeleted = 0 AND a.Blob IS NOT NULL
    ORDER BY SizeBytes DESC
    LIMIT ?`;

  /**
   * The largest logos with the number of items showing them.
   */
  public static readonly GET_LARGEST_LOGOS = `
    SELECT l.Id, l.ManifestId, l.Kind, l.Source, l.Name, LENGTH(l.FileData) AS SizeBytes,
      COUNT(i.Id) AS ItemCount, MIN(i.Id) AS FirstItemId
    FROM Logos l
    LEFT JOIN Items i ON i.LogoId = l.Id AND i.ManifestId = l.ManifestId AND i.IsDeleted = 0
    WHERE l.IsDeleted = 0 AND l.FileData IS NOT NULL
    GROUP BY l.Id, l.ManifestId
    ORDER BY SizeBytes DESC
    LIMIT ?`;
}
