import type { EncryptionKey } from '@/utils/dist/core/models/vault';

import { BaseRepository } from '../BaseRepository';
import { EncryptionKeyQueries } from '../queries/EncryptionKeyQueries';

/**
 * Repository for the asymmetric keypairs that receive mail.
 *
 * Every manifest owns one active keypair whose public half is published to the server as that manifest's
 * delivery key; rotation demotes rather than deletes, so mail encrypted to a superseded key stays
 * readable. The user's personal keypair is simply the personal manifest's active one.
 */
export class EncryptionKeyRepository extends BaseRepository {
  /**
   * Fetch every keypair that can decrypt inbound mail (both personal manifest and optional shared manifest keys).
   * @returns Array of encryption keys
   */
  public getAll(): EncryptionKey[] {
    return this.client.executeQuery<EncryptionKey>(EncryptionKeyQueries.GET_ALL);
  }

  /**
   * Get the user's active personal keypair.
   * @returns The active personal keypair, or null when absent
   */
  public getPrimary(): EncryptionKey | null {
    const personalManifestId = this.personalManifestId();
    return personalManifestId ? this.getActiveForManifest(personalManifestId) : null;
  }

  /**
   * Get a manifest's active keypair, whose public half is published to the server as that manifest's delivery
   * key. Returns null for a manifest that has no keypair in this vault.
   * @param manifestId - The manifest id the keypair is stamped with
   * @returns The active keypair, or null when the manifest has none
   */
  public getActiveForManifest(manifestId: string): EncryptionKey | null {
    const results = this.client.executeQuery<EncryptionKey>(EncryptionKeyQueries.GET_ACTIVE_FOR_MANIFEST, [manifestId]);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Make the given keypair the manifest's active one, demoting (never deleting) whatever it supersedes so
   * mail received before the rotation stays decryptable.
   * @param manifestId - The manifest id to stamp the keypair with
   * @param publicKey - The public half, published to the server for delivery
   * @param privateKey - The private half, which never leaves the manifest
   */
  public setActiveForManifest(manifestId: string, publicKey: string, privateKey: string): void {
    const now = this.now();
    this.client.executeUpdate(EncryptionKeyQueries.DEMOTE_FOR_MANIFEST, [now, manifestId]);
    this.client.executeUpdate(EncryptionKeyQueries.INSERT_FOR_MANIFEST, [this.generateId(), manifestId, publicKey, privateKey, now, now]);
  }
}
