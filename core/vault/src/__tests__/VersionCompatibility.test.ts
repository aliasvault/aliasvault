import { describe, it, expect } from 'vitest';
import { checkVersionCompatibility, extractVersionFromMigrationId, getLatestClientVersion } from '../utils/VersionCompatibility';
import { VAULT_VERSIONS } from '../sql/VaultVersions';

/*
 * Use a fixed client version for testing to make tests deterministic
 * and not dependent on the actual latest version in VAULT_VERSIONS
 */
const TEST_CLIENT_VERSION = '1.6.0';

describe('VersionCompatibility', () => {
  describe('getLatestClientVersion', () => {
    it('should return the latest client version from VAULT_VERSIONS', () => {
      const result = getLatestClientVersion();
      const expectedLatest = VAULT_VERSIONS[VAULT_VERSIONS.length - 1];

      expect(result).toBeDefined();
      expect(result).toBe(expectedLatest);
      expect(result.version).toBe(expectedLatest.version);
      expect(result.revision).toBe(expectedLatest.revision);
      expect(result.description).toBe(expectedLatest.description);
    });

    it('should return a valid VaultVersion object', () => {
      const result = getLatestClientVersion();
      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('revision');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('releaseVersion');
      expect(result).toHaveProperty('compatibleUpToVersion');
    });
  });

  describe('extractVersionFromMigrationId', () => {
    it('should extract version from valid migration ID', () => {
      const result = extractVersionFromMigrationId('20240917191243_1.4.1-RenameAttachmentsPlural');
      expect(result).toBe('1.4.1');
    });

    it('should extract version from different migration ID format', () => {
      const result = extractVersionFromMigrationId('20250310131554_1.5.0-AddTotpCodes');
      expect(result).toBe('1.5.0');
    });

    it('should return null for invalid migration ID', () => {
      const result = extractVersionFromMigrationId('InvalidMigrationId');
      expect(result).toBeNull();
    });

    it('should return null for migration ID without version', () => {
      const result = extractVersionFromMigrationId('20240917191243-NoVersion');
      expect(result).toBeNull();
    });
  });

  describe('checkVersionCompatibility', () => {
    describe('Known versions', () => {
      it('should be compatible with known version 1.0.0', () => {
        const result = checkVersionCompatibility('1.0.0');
        expect(result.isCompatible).toBe(true);
        expect(result.isKnownVersion).toBe(true);
        expect(result.isMajorVersionDifference).toBe(false);
        expect(result.clientVersion).toBeDefined();
      });

      it('should be compatible with known version 1.5.0', () => {
        const result = checkVersionCompatibility('1.5.0');
        expect(result.isCompatible).toBe(true);
        expect(result.isKnownVersion).toBe(true);
        expect(result.isMajorVersionDifference).toBe(false);
      });

      it('should be compatible with known version 1.6.0', () => {
        const result = checkVersionCompatibility('1.6.0');
        expect(result.isCompatible).toBe(true);
        expect(result.isKnownVersion).toBe(true);
      });
    });

    describe('Unknown versions - Same major version (backwards compatible)', () => {
      it('should be compatible with unknown patch version (1.6.1)', () => {
        const result = checkVersionCompatibility('1.6.1', TEST_CLIENT_VERSION);
        expect(result.isCompatible).toBe(true);
        expect(result.isKnownVersion).toBe(false);
        expect(result.isMajorVersionDifference).toBe(false);
        expect(result.isMinorVersionDifference).toBe(true);
      });

      it('should be compatible with unknown patch version (1.6.2)', () => {
        const result = checkVersionCompatibility('1.6.2', TEST_CLIENT_VERSION);
        expect(result.isCompatible).toBe(true);
        expect(result.isKnownVersion).toBe(false);
        expect(result.isMajorVersionDifference).toBe(false);
        expect(result.isMinorVersionDifference).toBe(true);
      });

      it('should be compatible with unknown minor version (1.49.0)', () => {
        const result = checkVersionCompatibility('1.49.0', TEST_CLIENT_VERSION);
        expect(result.isCompatible).toBe(true);
        expect(result.isKnownVersion).toBe(false);
        expect(result.isMajorVersionDifference).toBe(false);
        expect(result.isMinorVersionDifference).toBe(true);
      });

      it('should be compatible with unknown minor+patch version (1.99.5)', () => {
        const result = checkVersionCompatibility('1.99.5', TEST_CLIENT_VERSION);
        expect(result.isCompatible).toBe(true);
        expect(result.isKnownVersion).toBe(false);
        expect(result.isMajorVersionDifference).toBe(false);
        expect(result.isMinorVersionDifference).toBe(true);
      });
    });

    describe('Unknown versions - Different major version (incompatible)', () => {
      it('should be incompatible with major version 26.0.0', () => {
        const result = checkVersionCompatibility('26.0.0', TEST_CLIENT_VERSION);
        expect(result.isCompatible).toBe(false);
        expect(result.isKnownVersion).toBe(false);
        expect(result.isMajorVersionDifference).toBe(true);
        expect(result.isMinorVersionDifference).toBe(false);
      });

      it('should be incompatible with major version 31.1.5', () => {
        const result = checkVersionCompatibility('31.1.5', TEST_CLIENT_VERSION);
        expect(result.isCompatible).toBe(false);
        expect(result.isKnownVersion).toBe(false);
        expect(result.isMajorVersionDifference).toBe(true);
      });

      it('should be incompatible with major version 0.5.0', () => {
        const result = checkVersionCompatibility('0.5.0', TEST_CLIENT_VERSION);
        expect(result.isCompatible).toBe(false);
        expect(result.isKnownVersion).toBe(false);
        expect(result.isMajorVersionDifference).toBe(true);
      });
    });

    describe('Invalid versions', () => {
      it('should be incompatible with invalid version format', () => {
        const result = checkVersionCompatibility('invalid');
        expect(result.isCompatible).toBe(false);
      });

      it('should be incompatible with incomplete version', () => {
        const result = checkVersionCompatibility('1.5');
        expect(result.isCompatible).toBe(false);
      });

      it('should be incompatible with empty version', () => {
        const result = checkVersionCompatibility('');
        expect(result.isCompatible).toBe(false);
      });
    });

    describe('Edge cases', () => {
      it('should handle version with extra characters', () => {
        const result = checkVersionCompatibility('1.5.0-beta');
        expect(result.isCompatible).toBe(false);
      });

      it('should handle version with leading zeros (treats as 1.5.0)', () => {
        // Note: parseInt handles leading zeros, so "01.05.00" becomes 1.5.0
        const result = checkVersionCompatibility('01.05.00', TEST_CLIENT_VERSION);
        expect(result.isCompatible).toBe(true);
        expect(result.isKnownVersion).toBe(false);
      });
    });
  });
});
