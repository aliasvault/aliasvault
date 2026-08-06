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
   * @param manifestId - The manifest the item belongs to, when known
   * @returns Array of passkey objects
   */
  public getByItemId(itemId: string, manifestId?: string): Passkey[] {
    const scope = manifestId ?? this.resolveRowManifestId('Items', itemId);
    if (!scope) {
      return [];
    }

    const results = this.client.executeQuery<PasskeyRow>(
      PasskeyQueries.GET_BY_ITEM_ID,
      [itemId, scope]
    );
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

      this.client.executeUpdate(PasskeyQueries.INSERT, [
        passkey.Id,
        passkey.ItemId,
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
   * @param manifestId - The manifest the passkey belongs to, when known
   * @returns The number of rows updated
   */
  public async deleteById(passkeyId: string, manifestId?: string): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      const scope = manifestId ?? this.resolveRowManifestId('Passkeys', passkeyId);
      if (!scope) {
        return 0;
      }
      return this.client.executeUpdate(PasskeyQueries.SOFT_DELETE, [
        currentDateTime,
        passkeyId,
        scope
      ]);
    });
  }

  /**
   * Delete all passkeys for a specific item (soft delete).
   * @param itemId - The ID of the item
   * @param manifestId - The manifest the item belongs to, when known
   * @returns The number of rows updated
   */
  public async deleteByItemId(itemId: string, manifestId?: string): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      const scope = manifestId ?? this.resolveRowManifestId('Items', itemId);
      if (!scope) {
        return 0;
      }
      return this.client.executeUpdate(PasskeyQueries.SOFT_DELETE_BY_ITEM, [
        currentDateTime,
        itemId,
        scope
      ]);
    });
  }

  /**
   * Update a passkey's display name.
   * @param passkeyId - The ID of the passkey to update
   * @param displayName - The new display name
   * @param manifestId - The manifest the passkey belongs to, when known
   * @returns The number of rows updated
   */
  public async updateDisplayName(passkeyId: string, displayName: string, manifestId?: string): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      const scope = manifestId ?? this.resolveRowManifestId('Passkeys', passkeyId);
      if (!scope) {
        return 0;
      }
      return this.client.executeUpdate(PasskeyQueries.UPDATE_DISPLAY_NAME, [
        displayName,
        currentDateTime,
        passkeyId,
        scope
      ]);
    });
  }
}
