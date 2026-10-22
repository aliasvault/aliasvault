/**
 * The latest revision of a single logical manifest.
 */
export type ManifestRevision = {
  manifestId: string;
  revision: number;
  /** The name of a shared manifest, encrypted with the manifest's own key (base64). */
  encryptedName?: string | null;
  /** The generation of the manifest's VEK its content is encrypted with. */
  keyVersion?: number;
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
 * The email domains a server serves; hidden private domains are also in the private list.
 */
export type EmailDomains = {
  privateEmailDomainList: string[];
  hiddenPrivateEmailDomainList: string[];
  publicEmailDomainList: string[];
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
  emailDomains?: EmailDomains;
  pendingSharingInvitations?: number;
}
