export type { RecoveryMetadata } from '@aliasvault/vault-sync';

export interface GuardianKeys {
  guardianKeyHex: string;
  rsaPrivateKey: JsonWebKey;
  rsaPublicKey: JsonWebKey;
  commitment: string;
}
