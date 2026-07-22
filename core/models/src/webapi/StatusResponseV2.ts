/**
 * The latest revision of a single logical manifest.
 */
export type ManifestRevision = {
  manifestId: string;
  isRoot: boolean;
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
  /** Whether the user has a vault key (KEK/VEK model). Optional: absent on older servers. */
  hasVaultKey?: boolean;
}
