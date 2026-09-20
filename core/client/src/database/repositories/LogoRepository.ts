import { LogoKinds } from '@aliasvault/models/vault';

import { vaultCodecLogoContentHash, vaultCodecLogoIdFor } from '../../rust/RustCore';
import { logExpected } from '../../utilities/Diagnostics';
import { BaseRepository } from '../BaseRepository';
import { LogoQueries } from '../queries/LogoQueries';

import type { DbOp } from '../DbOp';
import type { ItemLogo, LogoKind } from '@aliasvault/models/vault';

/**
 * Repository for item logo operations.
 *
 * Every logo an item can have lives in one table, keyed by (Kind, Source): a fetched favicon under its
 * domain, a built-in logo under its catalog key, an uploaded image under its content hash. Ids are
 * derived from that key by the Rust core rather than randomly generated, so every device and platform
 * produces the same row for the same logo instead of creating duplicates that collide on
 * UNIQUE(ManifestId, Kind, Source).
 */
export class LogoRepository extends BaseRepository {
  /**
   * Check whether the vault already holds a favicon for this domain, in any manifest.
   * @param source The normalized source domain (e.g., 'github.com')
   * @returns True if any manifest holds a favicon for this domain
   */
  public *hasFaviconForSource(source: string): DbOp<boolean> {
    const rows = yield* this.query<{ Id: string }>(LogoQueries.FIND_ANY_ID_FOR_KEY, [LogoKinds.Favicon, source]);
    return rows.length > 0;
  }

  /**
   * The image bytes the vault already holds for a domain, in any manifest.
   * @param source The normalized source domain (e.g., 'github.com')
   * @returns The favicon bytes, or null when no manifest holds one for this domain
   */
  public *getFaviconData(source: string): DbOp<Uint8Array | null> {
    const row = (yield* this.query<{ FileData: Uint8Array | null }>(LogoQueries.GET_BEST_FOR_KEY, [LogoKinds.Favicon, source]))[0];
    return row?.FileData && row.FileData.length > 0 ? new Uint8Array(row.FileData) : null;
  }

  /**
   * Get the id of the logo with this kind and key inside one manifest, if that manifest holds it.
   * @param manifestId The manifest to look in
   * @param kind The logo kind
   * @param source The natural key within that kind
   * @returns The logo id if found, null otherwise
   */
  public *getIdForKey(manifestId: string, kind: LogoKind, source: string): DbOp<string | null> {
    const rows = yield* this.query<{ Id: string }>(LogoQueries.GET_ID_FOR_KEY, [manifestId, kind, source]);
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
    const inScope = await this.run(this.getIdForKey(manifestId, kind, source));
    if (inScope) {
      return inScope;
    }

    const origin = (await this.run(this.query<{ FileData: Uint8Array | null; MimeType: string | null; Name: string | null }>(
      LogoQueries.GET_BEST_FOR_KEY,
      [kind, source]
    )))[0];
    if (!origin) {
      return null;
    }

    const fileData = origin.FileData ? new Uint8Array(origin.FileData) : null;
    return this.getOrCreate(manifestId, kind, source, fileData, currentDateTime, { mimeType: origin.MimeType, name: origin.Name });
  }

  /**
   * Get a logo's identity (kind, key, label) by id, or null when it no longer exists.
   * @param logoId The logo id to look up
   * @param manifestId The manifest of the item pointing at it
   * @returns The logo, or null
   */
  public *getById(logoId: string, manifestId: string): DbOp<ItemLogo | null> {
    const rows = yield* this.query<{ Id: string; Kind: LogoKind; Source: string; Name: string | null }>(LogoQueries.GET_BY_ID, [logoId, manifestId]);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Get or create the logo for a kind and key inside one manifest, refreshing its image data.
   *
   * The row's stamp and the id derived for it come from the same `manifestId`, so a logo can never be
   * stored under a scope other than the one its id was derived for.
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
    await this.run(this.execute(LogoQueries.UPSERT, [
      logoId,
      kind,
      source,
      manifestId,
      fileData,
      options.mimeType ?? null,
      options.name ?? null,
      currentDateTime,
      currentDateTime
    ]));
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
      logExpected('[Logos] Converting a logo image to bytes failed', error);
    }

    return null;
  }
}
