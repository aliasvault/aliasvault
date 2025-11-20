export type StoreVaultRequest = {
  vaultBlob: string;
  publicEmailDomainList?: string[];
  privateEmailDomainList?: string[];
  hiddenPrivateEmailDomainList?: string[];
  vaultRevisionNumber?: number;
}
