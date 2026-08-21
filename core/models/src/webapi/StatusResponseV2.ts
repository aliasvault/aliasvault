/**
 * The latest revision of a single logical manifest.
 */
export type ManifestRevision = {
  manifestId: string;
  revision: number;
}

/**
 * Status response type (v2).
 */
export type StatusResponseV2 = {
  clientVersionSupported: boolean;
  serverVersion: string;
  manifestRevisions: ManifestRevision[];
  personalManifestId: string | null;
  srpSalt: string;
  capabilities?: Record<string, string>;
}
