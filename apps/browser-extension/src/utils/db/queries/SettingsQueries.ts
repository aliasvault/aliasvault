/**
 * SQL query constants for Settings operations.
 * Centralizes all settings-related queries to avoid duplication.
 */
export class SettingsQueries {
  /**
   * Get setting by key, within its manifest. A key names one row per manifest, so the manifest is
   * part of the address rather than something to disambiguate afterwards.
   */
  public static readonly GET_SETTING = `
    SELECT s.Value
    FROM Settings s
    WHERE s.ManifestId = ? AND s.Key = ?`;

  /**
   * Check if a setting exists within its manifest.
   */
  public static readonly COUNT_BY_KEY = `
    SELECT COUNT(*) as count
    FROM Settings
    WHERE ManifestId = ? AND Key = ?`;

  /**
   * Update an existing setting within its manifest.
   */
  public static readonly UPDATE_SETTING = `
    UPDATE Settings
    SET Value = ?,
        UpdatedAt = ?
    WHERE ManifestId = ? AND Key = ?`;

  /**
   * Insert a new setting, stamped with the manifest it belongs to.
   */
  public static readonly INSERT_SETTING = `
    INSERT INTO Settings (ManifestId, Key, Value, CreatedAt, UpdatedAt, IsDeleted)
    VALUES (?, ?, ?, ?, ?, ?)`;
}
