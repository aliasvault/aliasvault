/**
 * Inbox service — orchestrates manifest fetch, new email detection, and email retrieval.
 * Reads inboxManifestCid from VaultRegistry public ledger via indexer,
 * fetches plaintext manifest from IPFS, identifies new emails, downloads + decrypts.
 */

import { decryptEmailBlob, DecryptedEmail } from './EmailDecryptionService';

export interface InboxManifest {
  version: number;
  emails: Array<{ cid: string; ts: number }>;
}

export interface DecryptedEmailWithCid extends DecryptedEmail {
  cid: string;
}

/**
 * CIDv1 validation — CIDs must start with 'bafy' (dag-pb) or 'bafk' (raw).
 */
export function assertInboxCIDv1(cid: string): void {
  if (!cid || typeof cid !== 'string') {
    throw new Error('CID must be a non-empty string');
  }
  if (!cid.startsWith('bafy') && !cid.startsWith('bafk')) {
    throw new Error(`Expected CIDv1 (starts with bafy/bafk), got: ${cid.substring(0, 20)}`);
  }
}

/**
 * Fetch and parse inbox manifest from IPFS.
 * Manifest is plaintext JSON — not encrypted.
 */
export async function fetchManifest(
  pinata: { download: (cid: string) => Promise<Uint8Array> },
  manifestCid: string,
): Promise<InboxManifest> {
  assertInboxCIDv1(manifestCid);

  const bytes = await pinata.download(manifestCid);
  const json = JSON.parse(new TextDecoder().decode(bytes));

  if (typeof json.version !== 'number' || !Array.isArray(json.emails)) {
    throw new Error('Invalid manifest: missing version or emails array');
  }

  return json as InboxManifest;
}

/**
 * Compare manifest entries against locally cached CIDs.
 * Returns only new CIDs not already in cache.
 */
export function getNewEmailCids(manifest: InboxManifest, cachedCids: Set<string>): string[] {
  return manifest.emails
    .map((entry) => entry.cid)
    .filter((cid) => !cachedCids.has(cid));
}

/**
 * Download an encrypted email blob from IPFS, decrypt with user's private key.
 * Returns DecryptedEmail with CID attached.
 */
export async function fetchAndDecryptEmail(
  pinata: { download: (cid: string) => Promise<Uint8Array> },
  cid: string,
  privateKey: Uint8Array,
): Promise<DecryptedEmailWithCid> {
  assertInboxCIDv1(cid);

  const encryptedBlob = await pinata.download(cid);
  const email = decryptEmailBlob(encryptedBlob, privateKey);

  return { ...email, cid };
}

/**
 * InboxService class — stateful orchestration for inbox operations.
 * Wraps contract reads and IPFS downloads.
 */
export class InboxService {
  private contractService: { readInboxManifestCid: () => Promise<string | null>; readEmailCount: () => Promise<number> };
  private pinata: { download: (cid: string) => Promise<Uint8Array> };

  constructor(
    contractService: { readInboxManifestCid: () => Promise<string | null>; readEmailCount: () => Promise<number> },
    pinata: { download: (cid: string) => Promise<Uint8Array> },
  ) {
    this.contractService = contractService;
    this.pinata = pinata;
  }

  /**
   * Read inboxManifestCid from VaultRegistry public ledger.
   */
  async readInboxManifestCid(): Promise<string | null> {
    return this.contractService.readInboxManifestCid();
  }

  /**
   * Read emailCount from VaultRegistry public ledger.
   */
  async readEmailCount(): Promise<number> {
    return this.contractService.readEmailCount();
  }

  /**
   * Fetch manifest from IPFS.
   */
  async fetchManifest(manifestCid: string): Promise<InboxManifest> {
    return fetchManifest(this.pinata, manifestCid);
  }

  /**
   * Download and decrypt a single email.
   */
  async fetchAndDecryptEmail(cid: string, privateKey: Uint8Array): Promise<DecryptedEmailWithCid> {
    return fetchAndDecryptEmail(this.pinata, cid, privateKey);
  }
}
