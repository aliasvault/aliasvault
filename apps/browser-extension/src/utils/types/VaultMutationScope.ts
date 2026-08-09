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
 * Scopes whose sync is deliberately kept out of the UI. These hold housekeeping data the user never asked to
 * save (per-item usage statistics are written as a side effect of autofilling or copying a field), so a spinner
 * or pending badge for them would only suggest that something important is in flight. The sync indicator is
 * reserved for user-initiated changes, where a confirmation that the change reached the server is the feedback
 * the user expects to get.
 */
export const SILENT_VAULT_MUTATION_SCOPES: readonly VaultMutationScope[] = [VaultDataBucketCategory.Stats];

/**
 * True when a scope is a manifest category (i.e. a dirty flag on it requires a full manifest push, not a
 * bucket-only push).
 * @param scope - the mutation scope
 */
export const isManifestScope = (scope: VaultMutationScope): scope is VaultManifestScope =>
  (ALL_VAULT_MANIFEST_SCOPES as readonly string[]).includes(scope);

/**
 * True when a scope's sync must stay invisible in the UI. It still syncs like any other scope; only the
 * indicators ignore it.
 * @param scope - the mutation scope
 */
export const isSilentScope = (scope: VaultMutationScope): boolean => SILENT_VAULT_MUTATION_SCOPES.includes(scope);

/**
 * True when the pending scopes hold at least one change worth showing an indicator for. An empty list counts as
 * visible: a vault marked dirty without any recorded scope predates per-scope tracking, and hiding a real
 * pending change is worse than showing a badge too many.
 * @param scopes - the currently pending mutation scopes
 */
export const hasUserVisibleScope = (scopes: readonly VaultMutationScope[]): boolean =>
  scopes.length === 0 || scopes.some(scope => !isSilentScope(scope));

/**
 * Options for executing a vault mutation.
 */
export type VaultMutationOptions = {
  /** What the mutation touches. Defaults to 'Main' (full manifest push) when omitted. */
  scope?: VaultMutationScope;
};
