import { BaseRepository } from '../BaseRepository';
import { LogoQueries } from '../queries/LogoQueries';

/**
 * Repository for Logo management operations.
 */
export class LogoRepository extends BaseRepository {
  /**
   * Check if a logo exists for the given source domain.
   * @param source The normalized source domain (e.g., 'github.com')
   * @returns True if a logo exists for this source
   */
  public hasLogoForSource(source: string): boolean {
    const existingLogos = this.client.executeQuery<{ Id: string }>(
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
  public getIdForSource(source: string): string | null {
    const existingLogos = this.client.executeQuery<{ Id: string }>(
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
  public getOrCreate(source: string, logoData: Uint8Array, currentDateTime: string): string {
    const existing = this.client.executeQuery<{ Id: string; IsDeleted: number }>(
      LogoQueries.GET_BY_SOURCE_INCLUDING_DELETED,
      [source]
    );

    if (existing.length > 0) {
      const row = existing[0];
      if (row.IsDeleted === 1) {
        // Restore a previously soft-deleted record and refill its FileData.
        this.client.executeUpdate(LogoQueries.RESTORE_WITH_FILE_DATA, [
          logoData,
          currentDateTime,
          row.Id
        ]);
      }
      return row.Id;
    }

    // Create new logo entry
    const logoId = this.generateId();
    this.client.executeUpdate(LogoQueries.INSERT, [
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
