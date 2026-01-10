import type { Passkey } from '@/utils/dist/core/models/vault';

import { BaseRepository } from '../BaseRepository';

/**
 * Extended passkey type with item metadata.
 */
export type PasskeyWithItemInfo = Passkey & {
  Username?: string | null;
  ItemName?: string | null;
};

/**
 * SQL query constants for Passkey operations.
 */
const PasskeyQueries = {
  /**
   * Get all passkeys for a specific relying party (rpId).
   * Joins with Items and FieldValues to get item name and username.
   */
  GET_BY_RP_ID: `
    SELECT
      p.Id,
      p.ItemId,
      p.RpId,
      p.UserId,
      p.PublicKey,
      p.PrivateKey,
      p.DisplayName,
      p.PrfKey,
      p.AdditionalData,
      p.CreatedAt,
      p.UpdatedAt,
      p.IsDeleted,
      i.Name as ItemName,
      fv.Value as Username
    FROM Passkeys p
    LEFT JOIN Items i ON p.ItemId = i.Id
    LEFT JOIN FieldValues fv ON fv.ItemId = i.Id AND fv.FieldKey = 'login.username' AND fv.IsDeleted = 0
    WHERE p.RpId = ? AND p.IsDeleted = 0
    ORDER BY p.CreatedAt DESC`,

  /**
   * Get a passkey by its ID.
   * Joins with Items and FieldValues to get item name and username.
   */
  GET_BY_ID: `
    SELECT
      p.Id,
      p.ItemId,
      p.RpId,
      p.UserId,
      p.PublicKey,
      p.PrivateKey,
      p.DisplayName,
      p.PrfKey,
      p.AdditionalData,
      p.CreatedAt,
      p.UpdatedAt,
      p.IsDeleted,
      i.Name as ItemName,
      fv.Value as Username
    FROM Passkeys p
    LEFT JOIN Items i ON p.ItemId = i.Id
    LEFT JOIN FieldValues fv ON fv.ItemId = i.Id AND fv.FieldKey = 'login.username' AND fv.IsDeleted = 0
    WHERE p.Id = ? AND p.IsDeleted = 0`,

  /**
   * Insert a new passkey.
   */
  INSERT: `
    INSERT INTO Passkeys (
      Id, ItemId, RpId, PublicKey, PrivateKey,
      PrfKey, DisplayName, AdditionalData, CreatedAt, UpdatedAt, IsDeleted
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

  /**
   * Soft delete a passkey by ID.
   */
  SOFT_DELETE: `
    UPDATE Passkeys
    SET IsDeleted = 1,
        UpdatedAt = ?
    WHERE Id = ?`,

  /**
   * Update passkey display name.
   */
  UPDATE_DISPLAY_NAME: `
    UPDATE Passkeys
    SET DisplayName = ?,
        UpdatedAt = ?
    WHERE Id = ?`
};

/**
 * Repository for Passkey CRUD operations.
 */
export class PasskeyRepository extends BaseRepository {
  /**
   * Get all passkeys for a specific relying party (rpId).
   * @param rpId - The relying party identifier (domain)
   * @returns Array of passkey objects with item info
   */
  public async getByRpId(rpId: string): Promise<PasskeyWithItemInfo[]> {
    const results = await this.client.executeQuery(PasskeyQueries.GET_BY_RP_ID, [rpId]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return results.map((row: any) => this.mapRow(row));
  }

  /**
   * Get a passkey by its ID.
   * @param passkeyId - The passkey ID
   * @returns The passkey object or null if not found
   */
  public async getById(passkeyId: string): Promise<PasskeyWithItemInfo | null> {
    const results = await this.client.executeQuery(PasskeyQueries.GET_BY_ID, [passkeyId]);

    if (results.length === 0) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.mapRow(results[0] as any);
  }

  /**
   * Create a new passkey linked to an item.
   * @param passkey - The passkey object to create (without timestamps and IsDeleted)
   */
  public async create(passkey: Omit<Passkey, 'CreatedAt' | 'UpdatedAt' | 'IsDeleted'>): Promise<void> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();

      // Convert PrfKey to Uint8Array if it's a number array
      let prfKeyData: Uint8Array | null = null;
      if (passkey.PrfKey) {
        prfKeyData = passkey.PrfKey instanceof Uint8Array ? passkey.PrfKey : new Uint8Array(passkey.PrfKey);
      }

      await this.client.executeUpdate(PasskeyQueries.INSERT, [
        passkey.Id,
        passkey.ItemId,
        passkey.RpId,
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
  public async delete(passkeyId: string): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      return this.client.executeUpdate(PasskeyQueries.SOFT_DELETE, [
        currentDateTime,
        passkeyId
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

  /**
   * Map a database row to a PasskeyWithItemInfo object.
   * @param row - Raw database row
   * @returns PasskeyWithItemInfo object
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapRow(row: any): PasskeyWithItemInfo {
    return {
      Id: row.Id,
      ItemId: row.ItemId,
      RpId: row.RpId,
      PublicKey: row.PublicKey,
      PrivateKey: row.PrivateKey,
      DisplayName: row.DisplayName,
      PrfKey: row.PrfKey,
      AdditionalData: row.AdditionalData,
      CreatedAt: row.CreatedAt,
      UpdatedAt: row.UpdatedAt,
      IsDeleted: row.IsDeleted,
      Username: row.Username,
      ItemName: row.ItemName
    };
  }
}
