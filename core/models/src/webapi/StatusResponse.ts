/**
 * Status response type (v1). Returned by GET /v1/Auth/status.
 */
export type StatusResponse = {
  clientVersionSupported: boolean;
  serverVersion: string;
  vaultRevision: number;
  srpSalt: string;
}
