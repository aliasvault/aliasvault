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
  /** The manifest owned by the user's personal group; every other entry is a shared one. */
  personalManifestId: string | null;
  srpSalt: string;
}
