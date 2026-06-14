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

// Valid 64-char hex addresses for tests
const ADDR_A = 'ac7cf01759cf510fa5b5592b3ae34cbfda1ed084623c66836a5f96ef82df376b';
const ADDR_B = 'b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2';
const ADDR_VR = '9cc11ce659c11068a29fd124ff3e7ab50ee0ada547b08e7f4561fee0787c22ac';
const ADDR_AR = '645ebbebf9c30ef2ff5e97cf7f161d17a9c3804bf9b5be6ae367f0ac71f451c7';

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
            const expected = crypto
                .createHash('sha256')
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
            const expected = crypto
                .createHash('sha256')
                .update(seed + SECRET_KEY_DOMAIN)
                .digest();
            const key = deriveSecretKey(seed);
            expect(Buffer.from(key).toString('hex')).toBe(expected.toString('hex'));
        });

        it('uses custom domain when provided', () => {
            const seed = 'compat-seed';
            const expected = crypto
                .createHash('sha256')
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

        const sampleConfig = `export const CONTRACTS: Record<string, ContractConfig> = {
  VaultRegistry: {
    address: '',
    version: '0.1.0',
    network: 'local',
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
            updateContractsConfig(configPath, ADDR_A);

            const result = fs.readFileSync(configPath, 'utf-8');
            expect(result).toContain(`address: '${ADDR_A}'`);
        });

        it('overwrites existing address', () => {
            updateContractsConfig(configPath, ADDR_A);
            updateContractsConfig(configPath, ADDR_B);

            const result = fs.readFileSync(configPath, 'utf-8');
            expect(result).toContain(`address: '${ADDR_B}'`);
            expect(result).not.toContain(`address: '${ADDR_A}'`);
        });

        it('preserves file structure', () => {
            updateContractsConfig(configPath, ADDR_A);

            const result = fs.readFileSync(configPath, 'utf-8');
            expect(result).toContain("version: '0.1.0'");
            expect(result).toContain('export const CONTRACTS');
        });

        it('throws if file does not contain expected pattern', () => {
            fs.writeFileSync(configPath, 'export const FOO = 42;\n', 'utf-8');
            expect(() => updateContractsConfig(configPath, ADDR_A)).toThrow(
                'Could not find VaultRegistry address field',
            );
        });

        it('throws with contract name in error message for non-default contract', () => {
            fs.writeFileSync(configPath, 'export const FOO = 42;\n', 'utf-8');
            expect(() => updateContractsConfig(configPath, ADDR_A, 'AliasRegistry')).toThrow(
                'Could not find AliasRegistry address field',
            );
        });

        describe('address validation', () => {
            it('rejects non-hex address', () => {
                expect(() => updateContractsConfig(configPath, 'not-hex-at-all')).toThrow('Invalid contract address');
            });

            it('rejects address shorter than 64 chars', () => {
                expect(() => updateContractsConfig(configPath, 'abcd1234')).toThrow('Invalid contract address');
            });

            it('rejects address with uppercase hex', () => {
                expect(() =>
                    updateContractsConfig(
                        configPath,
                        'AC7CF01759CF510FA5B5592B3AE34CBFDA1ED084623C66836A5F96EF82DF376B',
                    ),
                ).toThrow('Invalid contract address');
            });

            it('accepts valid 64-char lowercase hex', () => {
                updateContractsConfig(configPath, ADDR_A);
                const result = fs.readFileSync(configPath, 'utf-8');
                expect(result).toContain(`address: '${ADDR_A}'`);
            });
        });

        describe('network field', () => {
            it('updates network field when present', () => {
                updateContractsConfig(configPath, ADDR_A, 'VaultRegistry', 'preprod');
                const result = fs.readFileSync(configPath, 'utf-8');
                expect(result).toContain("network: 'preprod'");
            });

            it('defaults to local network', () => {
                updateContractsConfig(configPath, ADDR_A);
                const result = fs.readFileSync(configPath, 'utf-8');
                expect(result).toContain("network: 'local'");
            });

            it('warns when overwriting non-local network address', () => {
                const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
                // Set to preprod first
                updateContractsConfig(configPath, ADDR_A, 'VaultRegistry', 'preprod');
                // Overwrite with local
                updateContractsConfig(configPath, ADDR_B, 'VaultRegistry', 'local');
                expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('WARNING'));
                expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('preprod'));
                warnSpy.mockRestore();
            });

            it('does not warn when overwriting local network address', () => {
                const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
                updateContractsConfig(configPath, ADDR_A, 'VaultRegistry', 'local');
                updateContractsConfig(configPath, ADDR_B, 'VaultRegistry', 'preprod');
                expect(warnSpy).not.toHaveBeenCalled();
                warnSpy.mockRestore();
            });
        });

        describe('multi-contract support', () => {
            const multiContractConfig = `export const CONTRACTS = {
  VaultRegistry: {
    address: '',
    version: '0.1.0',
    network: 'local',
  },
  AliasRegistry: {
    address: '',
    version: '0.1.0',
    network: 'local',
  },
};
`;

            beforeEach(() => {
                fs.writeFileSync(configPath, multiContractConfig, 'utf-8');
            });

            it('updates VaultRegistry with default contractName param', () => {
                updateContractsConfig(configPath, ADDR_VR);
                const result = fs.readFileSync(configPath, 'utf-8');
                expect(result).toContain(`address: '${ADDR_VR}'`);
                expect(result).toMatch(/AliasRegistry[\s\S]*address: ''/);
            });

            it('updates AliasRegistry when contractName specified', () => {
                updateContractsConfig(configPath, ADDR_AR, 'AliasRegistry');
                const result = fs.readFileSync(configPath, 'utf-8');
                expect(result).toContain(`address: '${ADDR_AR}'`);
                expect(result).toMatch(/VaultRegistry[\s\S]*address: ''/);
            });

            it('updates both contracts independently', () => {
                updateContractsConfig(configPath, ADDR_VR, 'VaultRegistry', 'preprod');
                updateContractsConfig(configPath, ADDR_AR, 'AliasRegistry', 'preprod');
                const result = fs.readFileSync(configPath, 'utf-8');
                expect(result).toContain(`address: '${ADDR_VR}'`);
                expect(result).toContain(`address: '${ADDR_AR}'`);
            });
        });
    });
});
