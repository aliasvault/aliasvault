/**
 * Known data-bucket categories for the manifest-v1 storage format. Each value is one small,
 * independently-versioned, user-scoped category of encrypted data kept out of the main vault content
 * manifest so it syncs cheaply. Serialized as its string name on the wire.
 */
export const VaultDataBucketCategory = {
  /**
   * User client settings (sort order, autofill prefs, identity defaults, etc.).
   */
  Settings: 'Settings',

  /**
   * Per-item usage statistics (last used, use counts).
   */
  Stats: 'Stats',
} as const;

/**
 * Type representing all valid vault data bucket category values.
 */
export type VaultDataBucketCategoryValue = typeof VaultDataBucketCategory[keyof typeof VaultDataBucketCategory];

/**
 * Human-readable description per category, emitted into the generated platform variants' doc comments.
 */
export const VaultDataBucketCategoryDescriptions: Record<VaultDataBucketCategoryValue, string> = {
  Settings: 'User client settings (sort order, autofill prefs, identity defaults, etc.).',
  Stats: 'Per-item usage statistics (last used, use counts).',
};
