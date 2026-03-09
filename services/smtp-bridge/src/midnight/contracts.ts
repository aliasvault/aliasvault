import { createHash } from 'crypto';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import {
  AliasRegistry,
  VaultRegistry,
  createVaultRegistryPrivateState,
  vaultRegistryWitnesses,
} from '@aliasvault/contract';

/**
 * Derive relay commitment matching the Compact circuit:
 *   persistentCommit<Bytes<32>>(pad(32, "vault:relay:"), relayKey)
 *
 * NOTE: The actual on-chain commitment is computed by the Compact runtime
 * when the relay key is provided as a witness. This derivation is for
 * logging/operator verification only.
 */
export function deriveRelayCommitment(relayKey: Uint8Array): Uint8Array {
  const domainSeparator = 'vault:relay:';
  const padded = new Uint8Array(32);
  const domainBytes = new TextEncoder().encode(domainSeparator);
  padded.set(domainBytes, 0);

  const hash = createHash('sha256');
  hash.update(padded);
  hash.update(relayKey);
  return new Uint8Array(hash.digest());
}

// --- Indexer reads (no contract join needed) ---

/**
 * Look up a VaultRegistry contract address from AliasRegistry via indexer.
 * Uses member() check before lookup() to avoid throws on non-existent keys.
 * Pattern: AliasService.checkAliasAvailable() in browser extension.
 */
export async function lookupAliasVaultAddress(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicDataProvider: any,
  aliasRegistryAddress: string,
  aliasHash: Uint8Array,
): Promise<string | null> {
  const contractState = await publicDataProvider.queryContractState(aliasRegistryAddress);
  if (!contractState) return null;

  const ledger = AliasRegistry.ledger(contractState.data);

  try {
    if (!ledger.aliasContracts.member(aliasHash)) return null;
    return ledger.aliasContracts.lookup(aliasHash);
  } catch {
    return null;
  }
}

/**
 * Read emailPublicKey from a VaultRegistry's public ledger via indexer.
 * Returns null if key is zero bytes (not set).
 * Pattern: MidnightContractService.readEmailPublicKey() in browser extension.
 */
export async function readEmailPublicKeyFromIndexer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicDataProvider: any,
  contractAddress: string,
): Promise<Uint8Array | null> {
  const contractState = await publicDataProvider.queryContractState(contractAddress);
  if (!contractState) return null;

  const ledger = VaultRegistry.ledger(contractState.data);
  const emailPubKey = ledger.emailPublicKey as Uint8Array;

  if (emailPubKey.every((b: number) => b === 0)) return null;
  return emailPubKey;
}

/**
 * Read inboxManifestCid from a VaultRegistry's public ledger via indexer.
 * Returns null if CID is empty (no emails received yet).
 */
export async function readInboxManifestCidFromIndexer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicDataProvider: any,
  contractAddress: string,
): Promise<string | null> {
  const contractState = await publicDataProvider.queryContractState(contractAddress);
  if (!contractState) return null;

  const ledger = VaultRegistry.ledger(contractState.data);
  const cid = ledger.inboxManifestCid;

  return cid || null;
}

// --- Contract join for notifyNewMail ---

/**
 * Compiled contract descriptor for VaultRegistry (relay mode).
 * Built once, reused for all per-user contract joins.
 * Pattern: guardian portal's guardianRecoveryCompiledContract.
 */
const vaultRegistryCompiledContract = CompiledContract.make(
  'vault-registry',
  VaultRegistry.Contract,
).pipe(CompiledContract.withWitnesses(vaultRegistryWitnesses));

/**
 * Cache of joined VaultRegistry contracts by contract address.
 * Each user has a separate VaultRegistry; joining is expensive (ZK proof),
 * so we cache handles for reuse across notification batches.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const joinedContracts = new Map<string, any>();

/**
 * Join (or retrieve cached) VaultRegistry contract for relay notification.
 * Bridge joins as relay — not owner — so secretKey and backupKey are zeroed.
 * Pattern: guardian portal joinContract() with placeholder secretKey.
 */
export async function getOrJoinVaultRegistryForRelay(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  providers: any,
  contractAddress: string,
  relayKey: Uint8Array,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const cached = joinedContracts.get(contractAddress);
  if (cached) return cached;

  const contract = await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: vaultRegistryCompiledContract as any,
    privateStateId: `vaultRegistryRelay-${contractAddress}`,
    initialPrivateState: createVaultRegistryPrivateState(
      new Uint8Array(32), // secretKey — bridge is not the owner
      new Uint8Array(32), // backupKey — bridge has no backup key
      relayKey,           // relayKey — bridge's relay authorization
    ),
  });

  joinedContracts.set(contractAddress, contract);
  return contract;
}

/**
 * Call notifyNewMail on a user's VaultRegistry.
 * Joins the contract (or uses cached handle), then calls the circuit.
 * Relay authorization verified on-chain via local_relay_key() witness.
 */
export async function callNotifyNewMail(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  providers: any,
  contractAddress: string,
  manifestCid: string,
  relayKey: Uint8Array,
): Promise<void> {
  const contract = await getOrJoinVaultRegistryForRelay(providers, contractAddress, relayKey);
  await contract.callTx.notifyNewMail(manifestCid);
}
