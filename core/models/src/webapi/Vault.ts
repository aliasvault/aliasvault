/**
 * Vault type.
 */
export type Vault = {
  // Required properties, always part of the vault get/set model.
  username: string;
  blob: string;
  version: string;
  currentRevisionNumber: number;
  credentialsCount: number;
  createdAt: string;
  updatedAt: string;
  // Optional properties, only part of the vault get/set model if available and applicable.
  encryptionPublicKey?: string;
  emailAddressList?: string[];
  privateEmailDomainList?: string[];
  hiddenPrivateEmailDomainList?: string[];
  publicEmailDomainList?: string[];
}