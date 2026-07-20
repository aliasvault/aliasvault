/**
 * Scope of a local vault mutation. It tells the sync layer what actually changed so it can decide between a
 * full manifest push and a more efficient bucket-only push.
 */

import { VaultDataBucketCategory, type VaultDataBucketCategoryValue } from '@/utils/dist/core/models/vault';

export type VaultManifestScope = 'Main';

// A bucket scope is one of the generated data-bucket categories (single source of truth: Rust BUCKET_TABLES).
export type VaultBucketScope = VaultDataBucketCategoryValue;

export type VaultMutationScope = VaultManifestScope | VaultBucketScope;

export const ALL_VAULT_MANIFEST_SCOPES: readonly VaultManifestScope[] = ['Main'];

export const ALL_VAULT_BUCKET_SCOPES: readonly VaultBucketScope[] = Object.values(VaultDataBucketCategory);

export const ALL_VAULT_MUTATION_SCOPES: readonly VaultMutationScope[] = [...ALL_VAULT_MANIFEST_SCOPES, ...ALL_VAULT_BUCKET_SCOPES];

export const DEFAULT_VAULT_MUTATION_SCOPE: VaultMutationScope = 'Main';

/**
 * True when a scope is a manifest category (i.e. a dirty flag on it requires a full manifest push, not a
 * bucket-only push).
 * @param scope - the mutation scope
 */
export const isManifestScope = (scope: VaultMutationScope): scope is VaultManifestScope =>
  (ALL_VAULT_MANIFEST_SCOPES as readonly string[]).includes(scope);

/**
 * Storage key holding the dirty flag for a single scope. Each scope gets its OWN boolean key so a mutation
 * marks exactly its scope dirty via an idempotent write.
 * @param scope - the mutation scope
 */
export const dirtyScopeStorageKey = (scope: VaultMutationScope): `local:${string}` => `local:dirtyScope:${scope}`;

/**
 * Options for executing a vault mutation.
 */
export type VaultMutationOptions = {
  /** What the mutation touches. Defaults to 'Main' (full manifest push) when omitted. */
  scope?: VaultMutationScope;
};
