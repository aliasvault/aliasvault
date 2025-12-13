/**
 * Status response type.
 */
export type StatusResponse = {
  clientVersionSupported: boolean;
  serverVersion: string;
  vaultRevision: number;
  srpSalt: string;
}
