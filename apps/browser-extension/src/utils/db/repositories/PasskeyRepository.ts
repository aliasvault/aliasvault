import type { Passkey } from '@/utils/dist/core/models/vault';

import { BaseRepository } from '../BaseRepository';
import { PasskeyMapper, type PasskeyRow, type PasskeyWithItemRow, type PasskeyWithItem } from '../mappers/PasskeyMapper';
import { PasskeyQueries } from '../queries/PasskeyQueries';

/**
 * Repository for Passkey CRUD operations.
 */
export class PasskeyRepository extends BaseRepository {
  /**
   * Get all passkeys for a specific relying party (rpId).
   * @param rpId - The relying party identifier (domain)
   * @returns Array of passkey objects with credential info
   */
  public getByRpId(rpId: string): PasskeyWithItem[] {
    const results = this.client.executeQuery<PasskeyWithItemRow>(
      PasskeyQueries.GET_BY_RP_ID,
      [rpId]
    );
    return PasskeyMapper.mapRowsWithItem(results);
  }

  /**
   * Get a passkey by its ID.
   * @param passkeyId - The passkey ID
   * @returns The passkey object or null if not found
   */
  public getById(passkeyId: string): PasskeyWithItem | null {
    const results = this.client.executeQuery<PasskeyWithItemRow>(
      PasskeyQueries.GET_BY_ID_WITH_ITEM,
      [passkeyId]
    );

    if (results.length === 0) {
      return null;
    }

    return PasskeyMapper.mapRowWithItem(results[0]);
  }

  /**
   * Get all passkeys for a specific item.
   * @param itemId - The item ID
   * @returns Array of passkey objects
   */
  public getByItemId(itemId: string): Passkey[] {
    const results = this.client.executeQuery<PasskeyRow>(
      PasskeyQueries.GET_BY_ITEM_ID,
      [itemId]
    );
    return PasskeyMapper.mapRows(results);
  }

  /**
   * Create a new passkey linked to an item.
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

      this.client.executeUpdate(PasskeyQueries.INSERT, [
        passkey.Id,
        passkey.ItemId,
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
      ]);
    });
  }

  /**
   * Delete a passkey by its ID (soft delete).
   * @param passkeyId - The ID of the passkey to delete
   * @returns The number of rows updated
   */
  public async deleteById(passkeyId: string): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      return this.client.executeUpdate(PasskeyQueries.SOFT_DELETE, [
        currentDateTime,
        passkeyId
      ]);
    });
  }

  /**
   * Delete all passkeys for a specific item (soft delete).
   * @param itemId - The ID of the item
   * @returns The number of rows updated
   */
  public async deleteByItemId(itemId: string): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      return this.client.executeUpdate(PasskeyQueries.SOFT_DELETE_BY_ITEM, [
        currentDateTime,
        itemId
      ]);
    });
  }

  /**
   * Update a passkey's display name.
   * @param passkeyId - The ID of the passkey to update
   * @param displayName - The new display name
   * @returns The number of rows updated
   */
  public async updateDisplayName(passkeyId: string, displayName: string): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      return this.client.executeUpdate(PasskeyQueries.UPDATE_DISPLAY_NAME, [
        displayName,
        currentDateTime,
        passkeyId
      ]);
    });
  }
}
