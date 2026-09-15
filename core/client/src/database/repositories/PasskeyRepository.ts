import { BaseRepository } from '../BaseRepository';
import { PasskeyMapper, type PasskeyRow, type PasskeyWithItemRow, type PasskeyWithItem } from '../mappers/PasskeyMapper';
import { PasskeyQueries } from '../queries/PasskeyQueries';

import type { DbOp } from '../DbOp';
import type { Passkey } from '@aliasvault/models/vault';

/**
 * Repository for Passkey CRUD operations.
 */
export class PasskeyRepository extends BaseRepository {
  /**
   * Get all passkeys for a specific relying party (rpId).
   * @param rpId - The relying party identifier (domain)
   * @returns Array of passkey objects with credential info
   */
  public *getByRpId(rpId: string): DbOp<PasskeyWithItem[]> {
    const results = yield* this.query<PasskeyWithItemRow>(PasskeyQueries.GET_BY_RP_ID, [rpId]);
    return PasskeyMapper.mapRowsWithItem(results);
  }

  /**
   * Get a passkey by its ID.
   * @param passkeyId - The passkey ID
   * @returns The passkey object or null if not found
   */
  public *getById(passkeyId: string): DbOp<PasskeyWithItem | null> {
    const results = yield* this.query<PasskeyWithItemRow>(PasskeyQueries.GET_BY_ID_WITH_ITEM, [passkeyId]);

    if (results.length === 0) {
      return null;
    }

    return PasskeyMapper.mapRowWithItem(results[0]);
  }

  /**
   * Get all passkeys for a specific item.
   * @param itemId - The item ID
   * @param manifestId - The manifest the item belongs to, when known
   * @returns Array of passkey objects
   */
  public *getByItemId(itemId: string, manifestId?: string): DbOp<Passkey[]> {
    const scope = manifestId ?? (yield* this.resolveRowManifestId('Items', itemId));
    if (!scope) {
      return [];
    }

    const results = yield* this.query<PasskeyRow>(PasskeyQueries.GET_BY_ITEM_ID, [itemId, scope]);
    return PasskeyMapper.mapRows(results);
  }

  /**
   * Create a new passkey linked to an item.
   *
   * The manifest is not passed in: a passkey belongs to whichever manifest its item is in, and the
   * INSERT reads it from there (see {@link BaseQueries.MANIFEST_OF_ITEM}).
   * @param passkey - The passkey object to create
   */
  public async create(passkey: Omit<Passkey, 'CreatedAt' | 'UpdatedAt' | 'IsDeleted' | 'ManifestId'>): Promise<void> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();

      // Convert PrfKey to Uint8Array if it's a number array
      let prfKeyData: Uint8Array | null = null;
      if (passkey.PrfKey) {
        prfKeyData = passkey.PrfKey instanceof Uint8Array
          ? passkey.PrfKey
          : new Uint8Array(passkey.PrfKey);
      }

      // Convert UserHandle to Uint8Array if it's a number array
      let userHandleData: Uint8Array | null = null;
      if (passkey.UserHandle) {
        userHandleData = passkey.UserHandle instanceof Uint8Array
          ? passkey.UserHandle
          : new Uint8Array(passkey.UserHandle);
      }

      const manifestId = await this.run(this.writeManifestId());
      await this.run(this.execute(PasskeyQueries.INSERT, [
        passkey.Id,
        passkey.ItemId,
        passkey.ItemId,
        manifestId,
        passkey.RpId,
        userHandleData,
        passkey.PublicKey,
        passkey.PrivateKey,
        prfKeyData,
        passkey.DisplayName,
        passkey.AdditionalData ?? null,
        currentDateTime,
        currentDateTime,
        0
      ]));
    });
  }

  /**
   * Delete a passkey by its ID (soft delete).
   * @param passkeyId - The ID of the passkey to delete
   * @param manifestId - The manifest the passkey belongs to, when known
   * @returns The number of rows updated
   */
  public async deleteById(passkeyId: string, manifestId?: string): Promise<number> {
    return this.withTransaction(async () => {
      const scope = manifestId ?? await this.run(this.resolveRowManifestId('Passkeys', passkeyId));
      if (!scope) {
        return 0;
      }
      return this.run(this.execute(PasskeyQueries.SOFT_DELETE, [this.now(), passkeyId, scope]));
    });
  }
}
