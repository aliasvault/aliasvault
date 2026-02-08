import crypto from 'node:crypto';
import fs from 'node:fs';

/** Domain separator for deterministic secret key derivation */
export const SECRET_KEY_DOMAIN = ':aliasvault:vault-registry:owner';

/** Valid network targets */
export type NetworkTarget = 'local' | 'preview' | 'preprod';

const VALID_NETWORKS: readonly NetworkTarget[] = ['local', 'preview', 'preprod'] as const;

export interface DeployArgs {
  network: NetworkTarget;
  seed: string | undefined;
  dryRun: boolean;
}

/**
 * Derive a deterministic 32-byte secret key from a wallet seed.
 * Same seed always produces the same secretKey (reproducible across runs).
 * Uses SHA-256(seed + domain separator) as specified in story 2.5 Dev Notes.
 */
export function deriveSecretKey(seed: string): Uint8Array {
  return crypto.createHash('sha256')
    .update(seed + SECRET_KEY_DOMAIN)
    .digest();
}

/**
 * Parse CLI arguments for the deploy script.
 * No external dependencies — simple string matching.
 */
export function parseDeployArgs(argv: string[]): DeployArgs {
  const networkArg = argv.find(a => a.startsWith('--network='))?.split('=').slice(1).join('=');
  const seed = argv.find(a => a.startsWith('--seed='))?.split('=').slice(1).join('=');
  const dryRun = argv.includes('--dry-run');

  if (networkArg !== undefined && !VALID_NETWORKS.includes(networkArg as NetworkTarget)) {
    throw new Error(`Invalid network: "${networkArg}". Must be one of: ${VALID_NETWORKS.join(', ')}`);
  }

  const network: NetworkTarget = (networkArg as NetworkTarget) ?? 'local';

  return { network, seed, dryRun };
}

/**
 * Update the VaultRegistry address in shared/config/contracts.ts.
 * Uses targeted regex replacement to preserve comments and formatting.
 */
export function updateContractsConfig(configPath: string, contractAddress: string): void {
  const content = fs.readFileSync(configPath, 'utf-8');

  // Match the address field inside the VaultRegistry block
  const pattern = /(VaultRegistry:\s*\{[^}]*address:\s*')([^']*)(')/;

  if (!pattern.test(content)) {
    throw new Error('Could not find VaultRegistry address field in ' + configPath);
  }

  const updated = content.replace(pattern, `$1${contractAddress}$3`);
  fs.writeFileSync(configPath, updated, 'utf-8');
}
