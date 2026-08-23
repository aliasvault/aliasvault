/**
 * The latest revision of a single logical manifest.
 */
export type ManifestRevision = {
  manifestId: string;
  revision: number;
}

/**
 * The latest revision of a single data bucket, addressed by the manifest that owns it and its category.
 */
export type BucketRevision = {
  manifestId: string;
  category: string;
  revision: number;
}

/**
 * A piece of work the server needs this client to carry out, because it needs something only a client holds
 * (vault content, a vault key, a private key).
 */
export type PendingClientAction = {
  id: string;
  type: string;
  manifestId?: string | null;
  payload?: string | null;
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
  bucketRevisions?: BucketRevision[];
  pendingActions?: PendingClientAction[];
}
