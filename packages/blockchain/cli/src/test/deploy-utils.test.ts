import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// Import after mocks are set up
import {
  updateContractsConfig,
  deriveSecretKey,
  parseDeployArgs,
  SECRET_KEY_DOMAIN,
  ALIAS_REGISTRY_SECRET_KEY_DOMAIN,
} from '../deploy-utils';

describe('deploy-utils', () => {
  describe('deriveSecretKey', () => {
    it('returns a 32-byte Uint8Array', () => {
      const key = deriveSecretKey('test-seed');
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    it('is deterministic — same seed always produces same key', () => {
      const key1 = deriveSecretKey('deterministic-seed');
      const key2 = deriveSecretKey('deterministic-seed');
      expect(Buffer.from(key1).toString('hex')).toBe(Buffer.from(key2).toString('hex'));
    });

    it('different seeds produce different keys', () => {
      const key1 = deriveSecretKey('seed-a');
      const key2 = deriveSecretKey('seed-b');
      expect(Buffer.from(key1).toString('hex')).not.toBe(Buffer.from(key2).toString('hex'));
    });

    it('uses the correct domain separator', () => {
      const seed = 'my-seed';
      const expected = crypto.createHash('sha256')
        .update(seed + ':aliasvault:vault-registry:owner')
        .digest();
      const key = deriveSecretKey(seed);
      expect(Buffer.from(key).toString('hex')).toBe(expected.toString('hex'));
    });

    it('exports the domain separator constant', () => {
      expect(SECRET_KEY_DOMAIN).toBe(':aliasvault:vault-registry:owner');
    });

    it('exports the AliasRegistry domain separator constant', () => {
      expect(ALIAS_REGISTRY_SECRET_KEY_DOMAIN).toBe(':aliasvault:alias-registry:owner');
    });

    it('uses default VaultRegistry domain when no domain param provided', () => {
      const seed = 'compat-seed';
      const expected = crypto.createHash('sha256')
        .update(seed + SECRET_KEY_DOMAIN)
        .digest();
      const key = deriveSecretKey(seed);
      expect(Buffer.from(key).toString('hex')).toBe(expected.toString('hex'));
    });

    it('uses custom domain when provided', () => {
      const seed = 'compat-seed';
      const expected = crypto.createHash('sha256')
        .update(seed + ALIAS_REGISTRY_SECRET_KEY_DOMAIN)
        .digest();
      const key = deriveSecretKey(seed, ALIAS_REGISTRY_SECRET_KEY_DOMAIN);
      expect(Buffer.from(key).toString('hex')).toBe(expected.toString('hex'));
    });

    it('different domains produce different keys for the same seed', () => {
      const seed = 'same-seed';
      const vrKey = deriveSecretKey(seed);
      const arKey = deriveSecretKey(seed, ALIAS_REGISTRY_SECRET_KEY_DOMAIN);
      expect(Buffer.from(vrKey).toString('hex')).not.toBe(Buffer.from(arKey).toString('hex'));
    });
  });

  describe('parseDeployArgs', () => {
    it('defaults to local network with no args', () => {
      const args = parseDeployArgs([]);
      expect(args.network).toBe('local');
      expect(args.seed).toBeUndefined();
      expect(args.dryRun).toBe(false);
    });

    it('parses --network=preview', () => {
      const args = parseDeployArgs(['--network=preview']);
      expect(args.network).toBe('preview');
    });

    it('parses --network=preprod', () => {
      const args = parseDeployArgs(['--network=preprod']);
      expect(args.network).toBe('preprod');
    });

    it('parses --seed flag', () => {
      const args = parseDeployArgs(['--seed=abc123']);
      expect(args.seed).toBe('abc123');
    });

    it('parses --dry-run flag', () => {
      const args = parseDeployArgs(['--dry-run']);
      expect(args.dryRun).toBe(true);
    });

    it('parses all flags together', () => {
      const args = parseDeployArgs(['--network=preview', '--seed=my-seed', '--dry-run']);
      expect(args.network).toBe('preview');
      expect(args.seed).toBe('my-seed');
      expect(args.dryRun).toBe(true);
    });

    it('throws on invalid network', () => {
      expect(() => parseDeployArgs(['--network=mainnet'])).toThrow('Invalid network');
    });
  });

  describe('updateContractsConfig', () => {
    let tmpDir: string;
    let configPath: string;

    const sampleConfig = `/**
 * Contract address management — single source of truth.
 * All apps import contract addresses from here (ADR-004 / project-context.md Rule 4).
 *
 * NEVER hardcode contract addresses as string literals in app code.
 * Import from this file exclusively.
 */

export interface ContractConfig {
  /** Deployed contract address (hex string). Empty until deployed. */
  address: string;
  /** Semantic version of the deployed contract. */
  version: string;
}

/**
 * All deployed contract configurations.
 * Updated by deployment scripts (Story 2.5) after contract deployment.
 */
export const CONTRACTS: Record<string, ContractConfig> = {
  VaultRegistry: {
    address: '', // Set after deployment (Story 2.5)
    version: '0.1.0',
  },
};
`;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-utils-test-'));
      configPath = path.join(tmpDir, 'contracts.ts');
      fs.writeFileSync(configPath, sampleConfig, 'utf-8');
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('fills empty address with new contract address', () => {
      const addr = 'ac7cf01759cf510fa5b5592b3ae34cbfda1ed084623c66836a5f96ef82df376b';
      updateContractsConfig(configPath, addr);

      const result = fs.readFileSync(configPath, 'utf-8');
      expect(result).toContain(`address: '${addr}'`);
    });

    it('overwrites existing address', () => {
      // First write
      const addr1 = 'aaaa';
      updateContractsConfig(configPath, addr1);

      // Overwrite
      const addr2 = 'bbbb';
      updateContractsConfig(configPath, addr2);

      const result = fs.readFileSync(configPath, 'utf-8');
      expect(result).toContain(`address: '${addr2}'`);
      expect(result).not.toContain(`address: '${addr1}'`);
    });

    it('preserves comments and file structure', () => {
      const addr = 'deadbeef';
      updateContractsConfig(configPath, addr);

      const result = fs.readFileSync(configPath, 'utf-8');
      expect(result).toContain('Contract address management');
      expect(result).toContain('NEVER hardcode');
      expect(result).toContain("version: '0.1.0'");
      expect(result).toContain('export interface ContractConfig');
    });

    it('throws if file does not contain expected pattern', () => {
      fs.writeFileSync(configPath, 'export const FOO = 42;\n', 'utf-8');
      expect(() => updateContractsConfig(configPath, 'abc')).toThrow('Could not find VaultRegistry address field');
    });

    it('throws with contract name in error message for non-default contract', () => {
      fs.writeFileSync(configPath, 'export const FOO = 42;\n', 'utf-8');
      expect(() => updateContractsConfig(configPath, 'abc', 'AliasRegistry')).toThrow('Could not find AliasRegistry address field');
    });

    describe('multi-contract support', () => {
      const multiContractConfig = `export const CONTRACTS = {
  VaultRegistry: {
    address: '',
    version: '0.1.0',
  },
  AliasRegistry: {
    address: '',
    version: '0.1.0',
  },
};
`;

      beforeEach(() => {
        fs.writeFileSync(configPath, multiContractConfig, 'utf-8');
      });

      it('updates VaultRegistry with default contractName param', () => {
        updateContractsConfig(configPath, 'vault-addr-123');
        const result = fs.readFileSync(configPath, 'utf-8');
        expect(result).toContain("VaultRegistry: {\n    address: 'vault-addr-123'");
        expect(result).toContain("AliasRegistry: {\n    address: ''");
      });

      it('updates AliasRegistry when contractName specified', () => {
        updateContractsConfig(configPath, 'alias-addr-456', 'AliasRegistry');
        const result = fs.readFileSync(configPath, 'utf-8');
        expect(result).toContain("AliasRegistry: {\n    address: 'alias-addr-456'");
        expect(result).toContain("VaultRegistry: {\n    address: ''");
      });

      it('updates both contracts independently', () => {
        updateContractsConfig(configPath, 'vault-addr', 'VaultRegistry');
        updateContractsConfig(configPath, 'alias-addr', 'AliasRegistry');
        const result = fs.readFileSync(configPath, 'utf-8');
        expect(result).toContain("VaultRegistry: {\n    address: 'vault-addr'");
        expect(result).toContain("AliasRegistry: {\n    address: 'alias-addr'");
      });
    });
  });
});
