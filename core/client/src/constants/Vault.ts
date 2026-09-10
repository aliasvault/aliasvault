/**
 * Number of days that soft-deleted items stay in the "Recently Deleted" trash
 * before being permanently pruned during vault sync. Mirrors the server-side
 * default exposed via Config.TrashRetentionDays in the Blazor client.
 */
export const TRASH_RETENTION_DAYS = 30;
