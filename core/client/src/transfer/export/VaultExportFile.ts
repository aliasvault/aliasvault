/**
 * The vault export file formats.
 */
export type VaultExportFormat = 'csv' | 'avux' | 'avex';

/** The content type each export format is handed to the host with. */
export const VAULT_EXPORT_MIME_TYPES: Record<VaultExportFormat, string> = {
  csv: 'text/csv',
  avux: 'application/zip',
  avex: 'application/octet-stream',
};

/**
 * The file name of a vault export made today, e.g. `aliasvault-export-2026-10-19.avex`.
 * @param format - The export format
 * @returns The file name
 */
export function vaultExportFileName(format: VaultExportFormat): string {
  return `aliasvault-export-${new Date().toISOString().substring(0, 10)}.${format}`;
}
