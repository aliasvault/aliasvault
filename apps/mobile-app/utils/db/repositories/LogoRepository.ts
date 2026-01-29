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
   * Insert new logo.
   */
  INSERT: `
    INSERT INTO Logos (Id, Source, FileData, CreatedAt, UpdatedAt, IsDeleted)
    VALUES (?, ?, ?, ?, ?, ?)`,

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
    // Check if a logo for this source already exists
    const existingId = await this.getIdForSource(source);
    if (existingId) {
      return existingId;
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
   * Extract and normalize source domain from a URL string.
   * Uses lowercase and removes www. prefix for case-insensitive matching.
   * @param urlString The URL to extract the domain from
   * @returns The normalized source domain (e.g., 'github.com'), or 'unknown' if extraction fails
   */
  public extractSourceFromUrl(urlString: string | undefined | null): string {
    if (!urlString) {
      return 'unknown';
    }

    try {
      const url = new URL(urlString.startsWith('http') ? urlString : `https://${urlString}`);
      // Normalize hostname: lowercase and remove www. prefix
      return url.hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return 'unknown';
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
