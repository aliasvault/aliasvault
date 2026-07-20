/**
 * The latest revision of a single logical manifest.
 */
export type ManifestRevision = {
  manifestId: string;
  category: string;
  revision: number;
}

/**
 * Status response type (v2). Returned by GET /v2/Auth/status.
 */
export type StatusResponseV2 = {
  clientVersionSupported: boolean;
  serverVersion: string;
  manifestRevisions: ManifestRevision[];
  srpSalt: string;
}
