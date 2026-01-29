import { describe, it, expect } from 'vitest';
import { VaultSqlGenerator } from '../sql/VaultSqlGenerator';

describe('VaultSqlGenerator', () => {
  const generator = new VaultSqlGenerator();

  describe('getCreateVaultSql', () => {
    it('should return SQL commands for creating a new vault', () => {
      const result = generator.getCreateVaultSql();

      expect(result.success).toBe(true);
      expect(result.sqlCommands.length).toBeGreaterThan(0);
      expect(result.version).toBe(generator.getLatestVersion().version);
      expect(result.migrationNumber).toBe(generator.getLatestVersion().revision);

      // Should include schema creation
      expect(result.sqlCommands[0]).toContain('CREATE TABLE');
      expect(result.sqlCommands.some(cmd => cmd.includes('CREATE TABLE "Aliases"'))).toBe(true);
      expect(result.sqlCommands.some(cmd => cmd.includes('__EFMigrationsHistory'))).toBe(true);
    });
  });

  describe('getUpgradeVaultSql', () => {
    it('should return empty commands when vault is already at target version', () => {
      const result = generator.getUpgradeVaultSql(generator.getLatestVersion().revision);

      expect(result.success).toBe(true);
      expect(result.sqlCommands).toEqual([]);
      expect(result.version).toBe(generator.getLatestVersion().version);
      expect(result.migrationNumber).toBe(generator.getLatestVersion().revision);
    });

    it('should return upgrade commands for older version', () => {
      const result = generator.getUpgradeVaultSql(1, 3); // Upgrade from v1.0.0 to v1.1.0

      expect(result.success).toBe(true);
      expect(result.sqlCommands.length).toBeGreaterThan(0);

      // Should include migration SQL
      expect(result.sqlCommands[0]).toContain('BEGIN TRANSACTION');
      expect(result.sqlCommands.some(cmd => cmd.includes('__EFMigrationsHistory'))).toBe(true);
    });

    it('should handle invalid target migration number', () => {
      const result = generator.getUpgradeVaultSql(1, 999);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should handle upgrade from revision 9 to 10 without returning null sqlCommands', () => {
      const result = generator.getUpgradeVaultSql(9, 10);

      expect(result.success).toBe(true);
      expect(result.sqlCommands).not.toBeNull();
      expect(Array.isArray(result.sqlCommands)).toBe(true);

      expect(result.sqlCommands.length).toBeGreaterThan(0);
      expect(result.sqlCommands[0]).toContain('BEGIN TRANSACTION');
      expect(result.sqlCommands.some(cmd => cmd.includes('__EFMigrationsHistory'))).toBe(true);

      expect(result.version).toBeDefined();
      expect(result.migrationNumber).toBe(10);
    });
  });

  describe('getUpgradeToVersionSql', () => {
    it('should upgrade to specific version', () => {
      const result = generator.getUpgradeToVersionSql(1, '1.2.0');

      expect(result.success).toBe(true);
      expect(result.sqlCommands.length).toBeGreaterThan(0);
    });

    it('should handle invalid version', () => {
      const result = generator.getUpgradeToVersionSql(1, '99.99.99');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('getVersionCheckSql', () => {
    it('should return SQL commands to check vault version', () => {
      const commands = generator.getVersionCheckSql();

      expect(commands.length).toBe(3);
      expect(commands[0]).toContain('sqlite_master');
      expect(commands[1]).toContain('vault_version');
      expect(commands[2]).toContain('vault_migration_number');
    });
  });

  describe('getVaultValidationSql', () => {
    it('should return SQL to validate vault structure', () => {
      const sql = generator.getVaultValidationSql();

      expect(sql).toContain('sqlite_master');
      expect(sql).toContain('Aliases');
      expect(sql).toContain('Services');
      expect(sql).toContain('Credentials');
    });
  });

  describe('parseVaultVersionInfo', () => {
    it('should parse vault version info correctly', () => {
      const info = generator.parseVaultVersionInfo(true, '1.2.0', '4');

      expect(info.currentVersion).toBe('1.2.0');
      expect(info.currentMigrationNumber).toBe(4);
      expect(info.needsUpgrade).toBe(info.currentMigrationNumber < generator.getLatestVersion().revision);
    });

    it('should handle missing Settings table', () => {
      const info = generator.parseVaultVersionInfo(false);

      expect(info.currentVersion).toBe('0.0.0');
      expect(info.currentMigrationNumber).toBe(0);
      expect(info.needsUpgrade).toBe(true);
    });

    it('should handle Settings table without version info', () => {
      const info = generator.parseVaultVersionInfo(true);

      expect(info.currentVersion).toBe('1.0.0');
      expect(info.currentMigrationNumber).toBe(1);
    });
  });

  describe('validateVaultStructure', () => {
    it('should validate vault with all required tables', () => {
      const tables = ['Aliases', 'Services', 'Credentials', 'Passwords', 'Settings'];
      const isValid = generator.validateVaultStructure(tables);

      expect(isValid).toBe(true);
    });

    it('should reject vault with missing core tables', () => {
      const tables = ['Aliases', 'Services'];
      const isValid = generator.validateVaultStructure(tables);

      expect(isValid).toBe(false);
    });

    it('should handle case-sensitive table names', () => {
      const tables = ['Aliases', 'Services', 'Credentials', 'Passwords', 'Settings'];
      const isValid = generator.validateVaultStructure(tables);

      expect(isValid).toBe(true);
    });

    it('should reject case-mismatched table names', () => {
      const tables = ['aliases', 'services', 'credentials', 'passwords', 'settings'];
      const isValid = generator.validateVaultStructure(tables);

      expect(isValid).toBe(false);
    });
  });

  describe('utility methods', () => {
    it('should return available versions', () => {
      const versions = generator.getAllVersions();

      expect(versions.length).toBeGreaterThan(0);
      expect(versions[0].version).toBe('1.0.0');
    });

    it('should return current version', () => {
      const version = generator.getLatestVersion();

      expect(version).toEqual(generator.getLatestVersion());
    });

    it('should return migration SQL by number', () => {
      const sql = generator.getMigrationSql(1);

      expect(sql).toBeDefined();
      expect(sql).toContain('BEGIN TRANSACTION');
      expect(sql).toContain('__EFMigrationsHistory');
    });

    it('should return complete schema SQL', () => {
      const sql = generator.getCompleteSchemaSql();

      expect(sql).toBeDefined();
      expect(sql).toContain('CREATE TABLE "Aliases"');
    });
  });
});