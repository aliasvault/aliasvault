import { vaultCodecLogoIdForSource } from '@/utils/RustCore';

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
   * Get the source domain a logo was stored under, or null when the logo no longer exists.
   * @param logoId The logo ID to look up
   * @returns The source domain, or null
   */
  public getSourceForId(logoId: string): string | null {
    const rows = this.client.executeQuery<{ Source: string }>(LogoQueries.GET_SOURCE_FOR_ID, [logoId]);
    return rows.length > 0 ? rows[0].Source : null;
  }

  /**
   * Get or create the personal-scope logo for the given source domain, refilling its image data.
   *
   * The ID is derived from (personal scope, source) by the Rust core rather than randomly generated,
   * so every device and platform produces the same row for a domain instead of minting duplicates
   * that collide on UNIQUE(SharedFolderId, Source).
   * @param source The normalized source domain (e.g., 'github.com')
   * @param logoData The logo image data as Uint8Array
   * @param currentDateTime The current date/time string for timestamps
   * @returns The logo ID
   */
  public async getOrCreate(source: string, logoData: Uint8Array, currentDateTime: string): Promise<string> {
    const logoId = await vaultCodecLogoIdForSource(null, source);
    this.client.executeUpdate(LogoQueries.UPSERT, [logoId, source, logoData, currentDateTime, currentDateTime]);
    return logoId;
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
