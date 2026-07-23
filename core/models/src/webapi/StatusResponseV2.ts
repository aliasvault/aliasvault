/**
 * The latest revision of a single logical manifest.
 */
export type ManifestRevision = {
  manifestId: string;
  isRoot: boolean;
  revision: number;
}

/**
 * Status response type (v2).
 */
export type StatusResponseV2 = {
  clientVersionSupported: boolean;
  serverVersion: string;
  manifestRevisions: ManifestRevision[];
  srpSalt: string;
  /** Whether the user has migrated to the manifest-v1 storage format (and the KEK/VEK key model). */
  isMigrated: boolean;
}
