import type { ItemLogo, LogoKind } from '@/utils/dist/core/models/vault';
import { LogoKinds } from '@/utils/dist/core/models/vault';
import { vaultCodecLogoContentHash, vaultCodecLogoIdFor } from '@/utils/RustCore';

import { BaseRepository } from '../BaseRepository';
import { LogoQueries } from '../queries/LogoQueries';

/**
 * An uploaded logo as shown in the user's logo library.
 */
export type CustomLogoEntry = ItemLogo & {
  FileData: Uint8Array | null;
};

/**
 * Repository for item logo operations.
 *
 * Every logo an item can have lives in one table, keyed by (Kind, Source): a fetched favicon under its
 * domain, a built-in logo under its catalog key, an uploaded image under its content hash. Ids are
 * derived from that key by the Rust core rather than randomly generated, so every device and platform
 * produces the same row for the same logo instead of minting duplicates that collide on
 * UNIQUE(SharedFolderId, Kind, Source).
 */
export class LogoRepository extends BaseRepository {
  /**
   * Check if a favicon exists for the given source domain.
   * @param source The normalized source domain (e.g., 'github.com')
   * @returns True if a favicon exists for this domain
   */
  public hasFaviconForSource(source: string): boolean {
    return this.getIdForKey(LogoKinds.Favicon, source) !== null;
  }

  /**
   * Get the id of the personal-scope logo with this kind and key, if it exists.
   * @param kind The logo kind
   * @param source The natural key within that kind
   * @returns The logo id if found, null otherwise
   */
  public getIdForKey(kind: LogoKind, source: string): string | null {
    const rows = this.client.executeQuery<{ Id: string }>(LogoQueries.GET_ID_FOR_KEY, [kind, source]);
    return rows.length > 0 ? rows[0].Id : null;
  }

  /**
   * Get a logo's identity (kind, key, label) by id, or null when it no longer exists.
   * @param logoId The logo id to look up
   * @returns The logo, or null
   */
  public getById(logoId: string): ItemLogo | null {
    const rows = this.client.executeQuery<{ Id: string; Kind: LogoKind; Source: string; Name: string | null }>(LogoQueries.GET_BY_ID, [logoId]);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Get or create the personal-scope logo for a kind and key, refreshing its image data.
   * @param kind The logo kind
   * @param source The natural key within that kind
   * @param fileData The image bytes, or null for a built-in logo which carries none
   * @param currentDateTime The current date/time string for timestamps
   * @param options Optional MIME type and user-facing label
   * @returns The logo id
   */
  public async getOrCreate(
    kind: LogoKind,
    source: string,
    fileData: Uint8Array | null,
    currentDateTime: string,
    options: { mimeType?: string | null; name?: string | null } = {}
  ): Promise<string> {
    const logoId = await vaultCodecLogoIdFor(null, kind, source);
    this.client.executeUpdate(LogoQueries.UPSERT, [
      logoId,
      kind,
      source,
      fileData,
      options.mimeType ?? null,
      options.name ?? null,
      currentDateTime,
      currentDateTime
    ]);
    return logoId;
  }

  /**
   * Store an uploaded image as a custom logo, or resolve the existing row when the vault already holds
   * exactly these bytes. The image's own hash is the key, so re-uploading a picture the user already
   * has costs nothing and every item that picks it shares one copy.
   * @param fileData The image bytes (already resized by the caller)
   * @param currentDateTime The current date/time string for timestamps
   * @param options Optional MIME type and user-facing label
   * @returns The logo id
   */
  public async storeUpload(
    fileData: Uint8Array,
    currentDateTime: string,
    options: { mimeType?: string | null; name?: string | null } = {}
  ): Promise<string> {
    const contentHash = await vaultCodecLogoContentHash(fileData);
    return this.getOrCreate(LogoKinds.Custom, contentHash, fileData, currentDateTime, options);
  }

  /**
   * The user's library of uploaded logos, newest first.
   * @returns The uploaded logos, with their image data
   */
  public listCustom(): CustomLogoEntry[] {
    const rows = this.client.executeQuery<{ Id: string; Kind: LogoKind; Source: string; Name: string | null; FileData: Uint8Array | null }>(
      LogoQueries.LIST_CUSTOM
    );
    return rows.map(row => ({ ...row, FileData: row.FileData ? new Uint8Array(row.FileData) : null }));
  }

  /**
   * Remove an uploaded logo from the library. Items still using it fall back to a placeholder.
   * @param logoId The logo id to delete
   * @param currentDateTime The current date/time string for timestamps
   * @returns The number of rows modified
   */
  public softDelete(logoId: string, currentDateTime: string): number {
    return this.client.executeUpdate(LogoQueries.SOFT_DELETE, [currentDateTime, logoId]);
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
   * Convert image data from various formats to Uint8Array.
   * @param image The image data in various possible formats
   * @returns Uint8Array of image data, or null if conversion fails
   */
  public convertToUint8Array(image: unknown): Uint8Array | null {
    if (!image) {
      return null;
    }

    try {
      // Handle object-like array conversion (from JSON deserialization)
      if (typeof image === 'object' && !ArrayBuffer.isView(image) && !Array.isArray(image)) {
        const values = Object.values(image as Record<string, number>);
        return new Uint8Array(values);
      }
      // Handle existing array types
      if (Array.isArray(image) || image instanceof ArrayBuffer || image instanceof Uint8Array) {
        return new Uint8Array(image as ArrayLike<number>);
      }
    } catch (error) {
      console.warn('Failed to convert logo image to Uint8Array:', error);
    }

    return null;
  }
}
