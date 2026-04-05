/**
 * SQL query constants for Settings operations.
 * Centralizes all settings-related queries to avoid duplication.
 */
export class SettingsQueries {
  /**
   * Get setting by key.
   */
  public static readonly GET_SETTING = `
    SELECT s.Value
    FROM Settings s
    WHERE s.Key = ?`;

  /**
   * Check if a setting exists.
   */
  public static readonly COUNT_BY_KEY = `
    SELECT COUNT(*) as count
    FROM Settings
    WHERE Key = ?`;

  /**
   * Update an existing setting.
   */
  public static readonly UPDATE_SETTING = `
    UPDATE Settings
    SET Value = ?,
        UpdatedAt = ?
    WHERE Key = ?`;

  /**
   * Insert a new setting.
   */
  public static readonly INSERT_SETTING = `
    INSERT INTO Settings (Key, Value, CreatedAt, UpdatedAt, IsDeleted)
    VALUES (?, ?, ?, ?, ?)`;

  /**
   * Get all encryption keys.
   */
  public static readonly GET_ENCRYPTION_KEYS = `
    SELECT
      x.PublicKey,
      x.PrivateKey,
      x.IsPrimary
    FROM EncryptionKeys x`;

  /**
   * Get TOTP codes for an item.
   */
  public static readonly GET_TOTP_FOR_ITEM = `
    SELECT
      Id,
      Name,
      SecretKey,
      ItemId
    FROM TotpCodes
    WHERE ItemId = ? AND IsDeleted = 0`;

  /**
   * Get attachments for an item.
   */
  public static readonly GET_ATTACHMENTS_FOR_ITEM = `
    SELECT
      Id,
      Filename,
      Blob,
      ItemId,
      CreatedAt,
      UpdatedAt,
      IsDeleted
    FROM Attachments
    WHERE ItemId = ? AND IsDeleted = 0`;
}
