import crypto from 'node:crypto';
import fs from 'node:fs';

/** Domain separator for deterministic secret key derivation (VaultRegistry) */
export const SECRET_KEY_DOMAIN = ':aliasvault:vault-registry:owner';

/** Domain separator for AliasRegistry secret key derivation */
export const ALIAS_REGISTRY_SECRET_KEY_DOMAIN = ':aliasvault:alias-registry:owner';

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
export function deriveSecretKey(seed: string, domain: string = SECRET_KEY_DOMAIN): Uint8Array {
    return crypto
        .createHash('sha256')
        .update(seed + domain)
        .digest();
}

/**
 * Parse CLI arguments for the deploy script.
 * No external dependencies — simple string matching.
 */
export function parseDeployArgs(argv: string[]): DeployArgs {
    const networkArg = argv
        .find((a) => a.startsWith('--network='))
        ?.split('=')
        .slice(1)
        .join('=');
    const seed = argv
        .find((a) => a.startsWith('--seed='))
        ?.split('=')
        .slice(1)
        .join('=');
    const dryRun = argv.includes('--dry-run');

    if (networkArg !== undefined && !VALID_NETWORKS.includes(networkArg as NetworkTarget)) {
        throw new Error(`Invalid network: "${networkArg}". Must be one of: ${VALID_NETWORKS.join(', ')}`);
    }

    const network: NetworkTarget = (networkArg as NetworkTarget) ?? 'local';

    return { network, seed, dryRun };
}

/**
 * Update a contract address in shared/config/contracts.ts.
 * Uses targeted regex replacement to preserve comments and formatting.
 */
export function updateContractsConfig(
    configPath: string,
    contractAddress: string,
    contractName: string = 'VaultRegistry',
    network: NetworkTarget = 'local',
): void {
    if (!/^[0-9a-f]{64}$/.test(contractAddress)) {
        throw new Error(`Invalid contract address: "${contractAddress}" — expected 64-char lowercase hex`);
    }

    let content = fs.readFileSync(configPath, 'utf-8');

    // Warn if overwriting a different network's address
    const networkMatch = new RegExp(
        `${contractName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:[^}]*network:\\s*'([^']*)'`,
    ).exec(content);
    if (networkMatch && networkMatch[1] !== network && networkMatch[1] !== 'local') {
        console.warn(`⚠️  WARNING: Overwriting ${contractName} ${networkMatch[1]} address with ${network} address`);
    }

    const escaped = contractName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Update address
    const addrPattern = new RegExp(`(${escaped}:\\s*\\{[^}]*address:\\s*')([^']*)(')`);
    if (!addrPattern.test(content)) {
        throw new Error(`Could not find ${contractName} address field in ${configPath}`);
    }
    content = content.replace(addrPattern, `$1${contractAddress}$3`);

    // Update network
    const netPattern = new RegExp(`(${escaped}:\\s*\\{[^}]*network:\\s*')([^']*)(')`);
    if (netPattern.test(content)) {
        content = content.replace(netPattern, `$1${network}$3`);
    }

    fs.writeFileSync(configPath, content, 'utf-8');
}
