/**
 * Vault version information
 * Auto-generated from EF Core migration filenames
 */

import { VaultVersion } from "../types/VaultVersion";

/**
 * All vault migrations/versions in chronological order.
 *
 * NOTE: this legacy migration chain is FROZEN — do not add new entries. It exists solely to
 * upgrade pre-2.0.0 blob-era vaults (via the user-facing upgrade prompt) up to vault version
 * 2.0.0, the first schema compatible with the manifest-v1 storage model. From 2.0.0 onwards the
 * local SQLite is re-materialized from COMPLETE_SCHEMA_SQL on every vault pull, so schema changes
 * ship through the full schema only: no individual migration scripts and no version entries here.
 * 
 * TODO: delete this once all active users have migrated to 2.0.0+
 */
export const VAULT_VERSIONS: VaultVersion[] = [
  {
    revision: 1,
    version: '1.0.0',
    description: 'Initial Migration',
    releaseVersion: '0.1.0',
    compatibleUpToVersion: '0.0.0',
  },
  {
    revision: 2,
    version: '1.0.1',
    description: 'Empty Test Migration',
    releaseVersion: '0.2.0',
    compatibleUpToVersion: '0.1.0',
  },
  {
    revision: 3,
    version: '1.0.2',
    description: 'Change Email Column',
    releaseVersion: '0.3.0',
    compatibleUpToVersion: '0.2.0',
  },
  {
    revision: 4,
    version: '1.1.0',
    description: 'Add Pki Tables',
    releaseVersion: '0.4.0',
    compatibleUpToVersion: '0.3.0',
  },
  {
    revision: 5,
    version: '1.2.0',
    description: 'Add Settings Table',
    releaseVersion: '0.4.0',
    compatibleUpToVersion: '0.3.0',
  },
  {
    revision: 6,
    version: '1.3.0',
    description: 'Update Identity Structure',
    releaseVersion: '0.5.0',
    compatibleUpToVersion: '0.4.0',
  },
  {
    revision: 7,
    version: '1.3.1',
    description: 'Make Username Optional',
    releaseVersion: '0.5.0',
    compatibleUpToVersion: '0.4.0',
  },
  {
    revision: 8,
    version: '1.4.0',
    description: 'Add Sync Support',
    releaseVersion: '0.6.0',
    compatibleUpToVersion: '0.5.0',
  },
  {
    revision: 9,
    version: '1.4.1',
    description: 'Rename Attachments Plural',
    releaseVersion: '0.6.0',
    compatibleUpToVersion: '0.13.0',
  },
  {
    revision: 10,
    version: '1.5.0',
    description: 'Add 2FA Tokens to credentials',
    releaseVersion: '0.14.0',
    compatibleUpToVersion: '0.23.0',
  },
  {
    revision: 11,
    version: '1.6.0',
    description: 'Add Passkey support',
    releaseVersion: '0.24.0',
    compatibleUpToVersion: '0.25.0',
  },
  {
    revision: 12,
    version: '1.7.0',
    description: 'Update to Field-Based Data Model',
    releaseVersion: '0.26.0',
    compatibleUpToVersion: '0.25.0',
  },
  {
    revision: 13,
    version: '2.0.0',
    description: 'Update to Field-Based Data Model',
    releaseVersion: '0.26.1',
    compatibleUpToVersion: '0.25.0',
  },
];
