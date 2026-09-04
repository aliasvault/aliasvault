import { Buffer } from 'buffer';

import { BaseRepository } from '../BaseRepository';

/**
 * SQL query constants for Logo operations.
 */
const LogoQueries = {
  /**
   * Check if logo exists for source.
   */
  GET_ID_FOR_SOURCE: `
    SELECT Id FROM Logos
    WHERE Source = ? AND IsDeleted = 0
    LIMIT 1`,

  /**
   * Look up a logo by source regardless of IsDeleted state.
   */
  GET_BY_SOURCE_INCLUDING_DELETED: `
    SELECT Id, IsDeleted FROM Logos
    WHERE Source = ?
    LIMIT 1`,

  /**
   * Insert new logo.
   */
  INSERT: `
    INSERT INTO Logos (Id, Source, FileData, CreatedAt, UpdatedAt, IsDeleted)
    VALUES (?, ?, ?, ?, ?, ?)`,

  /**
   * Restore a soft-deleted logo and refill its FileData in one statement.
   */
  RESTORE_WITH_FILE_DATA: `
    UPDATE Logos
    SET IsDeleted = 0,
        FileData = ?,
        UpdatedAt = ?
    WHERE Id = ?`,

  /**
   * Count items using a logo.
   */
  COUNT_USAGE: `
    SELECT COUNT(*) as count FROM Items
    WHERE LogoId = ? AND IsDeleted = 0`,

  /**
   * Hard delete logo.
   */
  HARD_DELETE: `
    DELETE FROM Logos WHERE Id = ?`
};

/**
 * Repository for Logo management operations.
 */
export class LogoRepository extends BaseRepository {
  /**
   * Check if a logo exists for the given source domain.
   * @param source The normalized source domain (e.g., 'github.com')
   * @returns True if a logo exists for this source
   */
  public async hasLogoForSource(source: string): Promise<boolean> {
    const existingLogos = await this.client.executeQuery<{ Id: string }>(
      LogoQueries.GET_ID_FOR_SOURCE,
      [source]
    );
    return existingLogos.length > 0;
  }

  /**
   * Get the logo ID for a given source domain if it exists.
   * @param source The normalized source domain (e.g., 'github.com')
   * @returns The logo ID if found, null otherwise
   */
  public async getIdForSource(source: string): Promise<string | null> {
    const existingLogos = await this.client.executeQuery<{ Id: string }>(
      LogoQueries.GET_ID_FOR_SOURCE,
      [source]
    );
    return existingLogos.length > 0 ? existingLogos[0].Id : null;
  }

  /**
   * Get or create a logo ID for the given source domain.
   * If a logo for this source already exists, returns its ID.
   * Otherwise, creates a new logo entry and returns its ID.
   * @param source The normalized source domain (e.g., 'github.com')
   * @param logoData The logo image data as Uint8Array
   * @param currentDateTime The current date/time string for timestamps
   * @returns The logo ID (existing or newly created)
   */
  public async getOrCreate(source: string, logoData: Uint8Array, currentDateTime: string): Promise<string> {
    const existing = await this.client.executeQuery<{ Id: string; IsDeleted: number }>(
      LogoQueries.GET_BY_SOURCE_INCLUDING_DELETED,
      [source]
    );

    if (existing.length > 0) {
      const row = existing[0];
      if (row.IsDeleted === 1) {
        // Restore a previously soft-deleted record and refill its FileData.
        await this.client.executeUpdate(LogoQueries.RESTORE_WITH_FILE_DATA, [
          logoData,
          currentDateTime,
          row.Id
        ]);
      }
      return row.Id;
    }

    // Create new logo entry
    const logoId = this.generateId();
    await this.client.executeUpdate(LogoQueries.INSERT, [
      logoId,
      source,
      logoData,
      currentDateTime,
      currentDateTime,
      0
    ]);

    return logoId;
  }

  /**
   * Clean up orphaned logo if no items reference it.
   * @param logoId - The ID of the logo to potentially clean up
   */
  public async cleanupOrphanedLogo(logoId: string): Promise<void> {
    const usageResult = await this.client.executeQuery<{ count: number }>(
      LogoQueries.COUNT_USAGE,
      [logoId]
    );
    const usageCount = usageResult.length > 0 ? usageResult[0].count : 0;

    if (usageCount === 0) {
      await this.client.executeUpdate(LogoQueries.HARD_DELETE, [logoId]);
      console.debug(`[LogoRepository] Deleted orphaned logo: ${logoId}`);
    }
  }

  /**
   * Convert logo data from various formats to Uint8Array.
   * @param logo The logo data in various possible formats
   * @returns Uint8Array of logo data, or null if conversion fails
   */
  public convertLogoToUint8Array(logo: unknown): Uint8Array | null {
    if (!logo) {
      return null;
    }

    try {
      // Handle base64 string (from native SQLite query results - both iOS and Android
      // return BLOB data as plain base64 strings through the React Native bridge)
      if (typeof logo === 'string') {
        return new Uint8Array(Buffer.from(logo, 'base64'));
      }
      // Handle object-like array conversion (from JSON deserialization)
      if (typeof logo === 'object' && !ArrayBuffer.isView(logo) && !Array.isArray(logo)) {
        const values = Object.values(logo as Record<string, number>);
        return new Uint8Array(values);
      }
      // Handle existing array types
      if (Array.isArray(logo) || logo instanceof ArrayBuffer || logo instanceof Uint8Array) {
        return new Uint8Array(logo as ArrayLike<number>);
      }
    } catch (error) {
      console.warn('Failed to convert logo to Uint8Array:', error);
    }

    return null;
  }
}
