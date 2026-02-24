import { assertCIDv1 } from '@aliasvault/contract';
import type { RecoveryMetadata } from '../types/recovery';

const DEFAULT_GATEWAY = 'https://gateway.pinata.cloud/ipfs';
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Fetch RecoveryMetadata from IPFS via public gateway.
 * Guardian portal only READS from IPFS — no writes.
 */
export async function fetchRecoveryMetadata(
  cid: string,
  gatewayUrl: string = DEFAULT_GATEWAY,
): Promise<RecoveryMetadata> {
  assertCIDv1(cid);

  const url = `${gatewayUrl}/${cid}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch recovery metadata: HTTP ${response.status}`);
  }

  const data: unknown = await response.json();
  return validateRecoveryMetadata(data);
}

function validateRecoveryMetadata(data: unknown): RecoveryMetadata {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid recovery metadata: not an object');
  }

  const obj = data as Record<string, unknown>;

  if (obj.version !== 1) {
    throw new Error(`Invalid recovery metadata: unsupported version ${String(obj.version)}`);
  }
  if (typeof obj.contractAddress !== 'string' || !obj.contractAddress) {
    throw new Error('Invalid recovery metadata: missing contractAddress');
  }
  if (typeof obj.networkId !== 'string' || !obj.networkId) {
    throw new Error('Invalid recovery metadata: missing networkId');
  }
  if (typeof obj.vaultOwnerCommitment !== 'string' || !obj.vaultOwnerCommitment) {
    throw new Error('Invalid recovery metadata: missing vaultOwnerCommitment');
  }

  return {
    version: 1,
    contractAddress: obj.contractAddress,
    networkId: obj.networkId,
    vaultOwnerCommitment: obj.vaultOwnerCommitment,
  };
}
