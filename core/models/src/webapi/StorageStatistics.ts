/**
 * Count and encrypted size of the blobs in one category.
 */
export type BlobCategoryStatistics = {
  /** The blob category, e.g. "favicon" or "attachment". */
  category: string;
  count: number;
  bytes: number;
}

/**
 * Encrypted bytes the server stores for one manifest.
 */
export type ManifestStorageStatistics = {
  manifestId: string;
  isPersonal: boolean;
  manifestBytes: number;
  bucketBytes: number;
  blobs: BlobCategoryStatistics[];
}

/**
 * Exact server-side storage of every manifest the caller can access (GET v2/Vault/storage).
 */
export type StorageStatisticsResponse = {
  manifests: ManifestStorageStatistics[];
}
