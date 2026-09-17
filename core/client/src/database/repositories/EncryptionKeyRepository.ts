import { BaseRepository } from '../BaseRepository';
import { EncryptionKeyQueries } from '../queries/EncryptionKeyQueries';

import type { DbOp } from '../DbOp';
import type { EncryptionKey } from '@aliasvault/models/vault';

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
  public *getAll(): DbOp<EncryptionKey[]> {
    return yield* this.query<EncryptionKey>(EncryptionKeyQueries.GET_ALL);
  }

  /**
   * Get the account keypair matching the given public half.
   * @param publicKey - The public half the grant was encrypted for
   * @returns The keypair, or null when this vault holds no account key with that public half
   */
  public *getAccountKeypair(publicKey: string): DbOp<EncryptionKey | null> {
    const personalManifestId = yield* this.personalManifestId();
    if (!personalManifestId) {
      return null;
    }
    const results = yield* this.query<EncryptionKey>(EncryptionKeyQueries.GET_ACCOUNT_KEY_BY_PUBLIC_KEY, [personalManifestId, publicKey]);
    return results.length > 0 ? results[0] : null;
  }
}
