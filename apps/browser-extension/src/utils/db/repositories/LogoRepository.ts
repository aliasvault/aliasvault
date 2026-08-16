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
 * UNIQUE(ManifestId, Kind, Source).
 */
export class LogoRepository extends BaseRepository {
  /**
   * The manifest the user's own logo library lives in: this client's own.
   * @returns The manifest id, or the empty scope when it is not known yet
   */
  private ownScope(): string {
    return this.personalManifestId() ?? '';
  }

  /**
   * Check whether the vault already holds a favicon for this domain, in any manifest.
   * @param source The normalized source domain (e.g., 'github.com')
   * @returns True if any manifest holds a favicon for this domain
   */
  public hasFaviconForSource(source: string): boolean {
    const rows = this.client.executeQuery<{ Id: string }>(LogoQueries.FIND_ANY_ID_FOR_KEY, [LogoKinds.Favicon, source]);
    return rows.length > 0;
  }

  /**
   * The image bytes the vault already holds for a domain, in any manifest.
   * @param source The normalized source domain (e.g., 'github.com')
   * @returns The favicon bytes, or null when no manifest holds one for this domain
   */
  public getFaviconData(source: string): Uint8Array | null {
    const row = this.client.executeQuery<{ FileData: Uint8Array | null }>(LogoQueries.GET_BEST_FOR_KEY, [LogoKinds.Favicon, source])[0];
    return row?.FileData && row.FileData.length > 0 ? new Uint8Array(row.FileData) : null;
  }

  /**
   * Get the id of the logo with this kind and key inside one manifest, if that manifest holds it.
   * @param manifestId The manifest to look in
   * @param kind The logo kind
   * @param source The natural key within that kind
   * @returns The logo id if found, null otherwise
   */
  public getIdForKey(manifestId: string, kind: LogoKind, source: string): string | null {
    const rows = this.client.executeQuery<{ Id: string }>(LogoQueries.GET_ID_FOR_KEY, [manifestId, kind, source]);
    return rows.length > 0 ? rows[0].Id : null;
  }

  /**
   * The id this logo has inside `manifestId`, copying it in from another manifest when it is not there yet.
   * @param manifestId The manifest the logo is needed in
   * @param kind The logo kind
   * @param source The natural key within that kind
   * @param currentDateTime The current date/time string for timestamps
   * @returns The logo id inside this manifest, or null when the vault holds no such logo at all
   */
  public async adoptIntoScope(manifestId: string, kind: LogoKind, source: string, currentDateTime: string): Promise<string | null> {
    const inScope = this.getIdForKey(manifestId, kind, source);
    if (inScope) {
      return inScope;
    }

    const origin = this.client.executeQuery<{ FileData: Uint8Array | null; MimeType: string | null; Name: string | null }>(
      LogoQueries.GET_BEST_FOR_KEY,
      [kind, source]
    )[0];
    if (!origin) {
      return null;
    }

    const fileData = origin.FileData ? new Uint8Array(origin.FileData) : null;
    return this.getOrCreate(manifestId, kind, source, fileData, currentDateTime, { mimeType: origin.MimeType, name: origin.Name });
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
   * Bring every item's logo into the item's own manifest, for items that have crossed a manifest boundary.
   * @param currentDateTime The current date/time string for timestamps
   * @returns The number of items repointed
   */
  public async reconcileItemLogoScopes(currentDateTime: string): Promise<number> {
    const foreign = this.client.executeQuery<{ Id: string; ManifestId: string; Kind: LogoKind; Source: string }>(
      LogoQueries.FIND_ITEMS_WITH_FOREIGN_LOGO
    );

    let repointed = 0;
    for (const item of foreign) {
      const logoId = await this.adoptIntoScope(item.ManifestId, item.Kind, item.Source, currentDateTime);
      if (logoId) {
        repointed += this.client.executeUpdate(LogoQueries.REPOINT_ITEM_LOGO, [logoId, item.Id, item.ManifestId]);
      }
    }
    return repointed;
  }

  /**
   * Get or create the logo for a kind and key inside one manifest, refreshing its image data.
   *
   * The row's stamp and the id derived for it come from the same `manifestId`, so a logo can never be
   * stored under a scope other than the one its id was minted for.
   * @param manifestId The manifest to write the logo into
   * @param kind The logo kind
   * @param source The natural key within that kind
   * @param fileData The image bytes, or null for a built-in logo which carries none
   * @param currentDateTime The current date/time string for timestamps
   * @param options Optional MIME type and user-facing label
   * @returns The logo id
   */
  public async getOrCreate(manifestId: string, kind: LogoKind, source: string, fileData: Uint8Array | null, currentDateTime: string, options: { mimeType?: string | null; name?: string | null } = {}): Promise<string> {
    const logoId = await vaultCodecLogoIdFor(manifestId, kind, source);
    this.client.executeUpdate(LogoQueries.UPSERT, [
      logoId,
      kind,
      source,
      manifestId,
      fileData,
      options.mimeType ?? null,
      options.name ?? null,
      currentDateTime,
      currentDateTime
    ]);
    return logoId;
  }

  /**
   * Store an uploaded image as a custom logo in one manifest, or resolve the existing row when that
   * manifest already holds exactly these bytes.
   * @param manifestId The manifest to write the logo into
   * @param fileData The image bytes (already resized by the caller)
   * @param currentDateTime The current date/time string for timestamps
   * @param options Optional MIME type and user-facing label
   * @returns The logo id
   */
  public async storeUpload(manifestId: string, fileData: Uint8Array, currentDateTime: string, options: { mimeType?: string | null; name?: string | null } = {}): Promise<string> {
    const contentHash = await vaultCodecLogoContentHash(fileData);
    return this.getOrCreate(manifestId, LogoKinds.Custom, contentHash, fileData, currentDateTime, options);
  }

  /**
   * The user's own library of uploaded logos, newest first.
   * @returns The uploaded logos, with their image data
   */
  public listCustom(): CustomLogoEntry[] {
    const rows = this.client.executeQuery<{ Id: string; Kind: LogoKind; Source: string; Name: string | null; FileData: Uint8Array | null }>(
      LogoQueries.LIST_CUSTOM,
      [this.ownScope()]
    );
    return rows.map(row => ({ ...row, FileData: row.FileData ? new Uint8Array(row.FileData) : null }));
  }

  /**
   * Remove an uploaded logo from the library (soft delete). Items still using it fall back to a placeholder.
   * @param logoId The logo id to delete
   * @param currentDateTime The current date/time string for timestamps
   * @returns The number of rows modified
   */
  public deleteById(logoId: string, currentDateTime: string): number {
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
