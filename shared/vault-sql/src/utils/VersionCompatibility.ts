/**
 * Utility for checking vault version compatibility using semantic versioning
 */

import { VAULT_VERSIONS } from '../sql/VaultVersions';
import type { VaultVersion } from '../types/VaultVersion';

/**
 * Result of version compatibility check
 */
export type VersionCompatibilityResult = {
  /**
   * Whether the database version is compatible with the current client
   */
  isCompatible: boolean;

  /**
   * The database version string (e.g., "1.6.1")
   */
  databaseVersion: string;

  /**
   * The current client's version info (if found)
   */
  clientVersion?: VaultVersion;

  /**
   * Whether the database version is known to the client
   */
  isKnownVersion: boolean;

  /**
   * Whether this is a major version difference
   */
  isMajorVersionDifference: boolean;

  /**
   * Whether this is a minor/patch version difference
   */
  isMinorVersionDifference: boolean;
}

/**
 * Parse a semantic version string into its components
 */
function parseSemanticVersion(version: string): { major: number; minor: number; patch: number } | null {
  const versionRegex = /^(\d+)\.(\d+)\.(\d+)$/;
  const match = versionRegex.exec(version);

  if (!match) {
    return null;
  }

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10)
  };
}

/**
 * Check if a database version is compatible with the current client using semantic versioning rules.
 *
 * Compatibility rules:
 * 1. If the database version is known to the client (exists in VAULT_VERSIONS), it's compatible
 * 2. If the database version is unknown:
 *    - Same major version (e.g., 1.6.1 vs 1.6.2 or 1.7.0): Compatible (backwards compatible minor/patch changes)
 *    - Different major version (e.g., 1.6.1 vs 2.0.0): Incompatible (breaking changes)
 *
 * This allows newer database versions with backwards-compatible changes to work with older clients,
 * while still preventing incompatibilities from major version changes.
 *
 * @param databaseVersion - The version string from the database migration (e.g., "1.6.1")
 * @returns VersionCompatibilityResult with compatibility information
 */
export function checkVersionCompatibility(databaseVersion: string): VersionCompatibilityResult {
  // Parse the database version
  const dbVersion = parseSemanticVersion(databaseVersion);

  if (!dbVersion) {
    return {
      isCompatible: false,
      databaseVersion,
      isKnownVersion: false,
      isMajorVersionDifference: false,
      isMinorVersionDifference: false
    };
  }

  // Check if this version is known to the client
  const knownVersion = VAULT_VERSIONS.find(v => v.version === databaseVersion);

  if (knownVersion) {
    // Known version - always compatible
    return {
      isCompatible: true,
      databaseVersion,
      clientVersion: knownVersion,
      isKnownVersion: true,
      isMajorVersionDifference: false,
      isMinorVersionDifference: false
    };
  }

  /*
   * Unknown version - check semantic versioning compatibility
   * Find the latest version known to this client
   */
  const latestClientVersion = VAULT_VERSIONS[VAULT_VERSIONS.length - 1];
  const clientVersion = parseSemanticVersion(latestClientVersion.version);

  if (!clientVersion) {
    return {
      isCompatible: false,
      databaseVersion,
      isKnownVersion: false,
      isMajorVersionDifference: false,
      isMinorVersionDifference: false
    };
  }

  /* Check if major versions match */
  const isMajorVersionDifference = dbVersion.major !== clientVersion.major;
  const isMinorVersionDifference = !isMajorVersionDifference &&
    (dbVersion.minor !== clientVersion.minor || dbVersion.patch !== clientVersion.patch);

  /* Compatible if same major version (backwards compatible minor/patch changes) */
  const isCompatible = !isMajorVersionDifference;

  return {
    isCompatible,
    databaseVersion,
    clientVersion: latestClientVersion,
    isKnownVersion: false,
    isMajorVersionDifference,
    isMinorVersionDifference
  };
}

/**
 * Extract version from a migration ID.
 *
 * Migration IDs follow the pattern: "YYYYMMDDHHMMSS_X.Y.Z-Description"
 * For example: "20240917191243_1.4.1-RenameAttachmentsPlural"
 *
 * @param migrationId - The migration ID from __EFMigrationsHistory
 * @returns The version string (e.g., "1.4.1") or null if not found
 */
export function extractVersionFromMigrationId(migrationId: string): string | null {
  const versionRegex = /_(\d+\.\d+\.\d+)-/;
  const versionMatch = versionRegex.exec(migrationId);

  return versionMatch?.[1] ?? null;
}
