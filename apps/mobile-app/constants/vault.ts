/**
 * Days a trashed item stays in "Recently Deleted" before the pruner deletes it. Re-exported from the vault registry,
 * which also generates the value the Rust pruner uses.
 */
export { TRASH_RETENTION_DEFAULT_DAYS as TRASH_RETENTION_DAYS } from '@aliasvault/models/vault';
