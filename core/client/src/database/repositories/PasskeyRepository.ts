import { BaseRepository } from '../BaseRepository';
import { PasskeyMapper, type PasskeyRow, type PasskeyWithItemRow, type PasskeyWithItem } from '../mappers/PasskeyMapper';
import { PasskeyQueries } from '../queries/PasskeyQueries';

import type { DbOp } from '../DbOp';
import type { ItemRef } from '../ItemRef';
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
   * @param manifestId - The manifest the passkey belongs to, which is its item's
   * @returns The passkey object or null if not found
   */
  public *getById(passkeyId: string, manifestId: string): DbOp<PasskeyWithItem | null> {
    const results = yield* this.query<PasskeyWithItemRow>(PasskeyQueries.GET_BY_ID_WITH_ITEM, [passkeyId, manifestId]);

    if (results.length === 0) {
      return null;
    }

    return PasskeyMapper.mapRowWithItem(results[0]);
  }

  /**
   * Get all passkeys for a specific item.
   * @param item - The item, named by its manifest and id
   * @returns Array of passkey objects
   */
  public *getByItemId(item: ItemRef): DbOp<Passkey[]> {
    const results = yield* this.query<PasskeyRow>(PasskeyQueries.GET_BY_ITEM_ID, [item.Id, item.ManifestId]);
    return PasskeyMapper.mapRows(results);
  }

  /**
   * Create a new passkey linked to an item.
   *
   * A passkey belongs to whichever manifest its item is in, so `ManifestId` names the item's manifest.
   * @param passkey - The passkey object to create
   */
  public async create(passkey: Omit<Passkey, 'CreatedAt' | 'UpdatedAt' | 'IsDeleted'>): Promise<void> {
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

      await this.run(this.execute(PasskeyQueries.INSERT, [
        passkey.Id,
        passkey.ItemId,
        passkey.ManifestId,
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
   * @param manifestId - The manifest the passkey belongs to, which is its item's
   * @returns The number of rows updated
   */
  public async deleteById(passkeyId: string, manifestId: string): Promise<number> {
    return this.withTransaction(() => this.run(this.execute(PasskeyQueries.SOFT_DELETE, [this.now(), passkeyId, manifestId])));
  }
}
