import type { IpfsService } from '@aliasvault/ipfs-service';
import type { InboxManifest, InboxManifestEntry } from '../types/email.js';

/**
 * Manages inbox manifests on IPFS.
 * Manifest is plaintext JSON containing only opaque CIDs + timestamps (no sender metadata).
 */
export class ManifestManager {
  constructor(private ipfs: IpfsService) {}

  /**
   * Create a new empty manifest.
   */
  createManifest(): InboxManifest {
    return { version: 1, emails: [] };
  }

  /**
   * Append an entry to an existing manifest.
   * Returns the new manifest (does not mutate the input).
   */
  appendEntry(manifest: InboxManifest, entry: InboxManifestEntry): InboxManifest {
    return {
      ...manifest,
      emails: [...manifest.emails, entry],
    };
  }

  /**
   * Serialize manifest to bytes for IPFS upload.
   */
  serialize(manifest: InboxManifest): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(manifest));
  }

  /**
   * Deserialize manifest from IPFS bytes.
   */
  deserialize(data: Uint8Array): InboxManifest {
    const json = new TextDecoder().decode(data);
    const parsed = JSON.parse(json);
    if (parsed.version !== 1 || !Array.isArray(parsed.emails)) {
      throw new Error('Invalid manifest format');
    }
    return parsed as InboxManifest;
  }

  /**
   * Download existing manifest from IPFS, or create a new one if CID is empty.
   */
  async fetchOrCreate(manifestCid: string | null | undefined): Promise<InboxManifest> {
    if (!manifestCid) {
      return this.createManifest();
    }
    const data = await this.ipfs.download(manifestCid);
    return this.deserialize(data);
  }

  /**
   * Upload manifest to IPFS. Returns the new CID.
   */
  async upload(manifest: InboxManifest): Promise<string> {
    const data = this.serialize(manifest);
    return this.ipfs.upload(data);
  }

  /**
   * Convenience: fetch existing manifest, append entry, upload, return new CID.
   */
  async appendAndUpload(
    existingManifestCid: string | null | undefined,
    emailCid: string,
  ): Promise<string> {
    const manifest = await this.fetchOrCreate(existingManifestCid);
    const entry: InboxManifestEntry = { cid: emailCid, ts: Math.floor(Date.now() / 1000) };
    const updated = this.appendEntry(manifest, entry);
    return this.upload(updated);
  }
}
