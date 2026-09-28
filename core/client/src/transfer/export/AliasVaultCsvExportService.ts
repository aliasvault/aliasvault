import { FieldKey, normalizeTotpAlgorithm, normalizeTotpDigits, normalizeTotpPeriod, TOTP_DEFAULT_ALGORITHM, TOTP_DEFAULT_DIGITS, TOTP_DEFAULT_PERIOD } from '@aliasvault/models/vault';

import { parseDateExact } from '../shared/DateTimeUtils';
import { formatTotpUri } from '../shared/TotpUri';

import { writeCsv } from './CsvWriter';

import type { FolderEntity, ItemEntity, TotpCodeEntity } from '../shared/VaultEntities';

/** The columns of the AliasVault CSV export. */
export const ALIASVAULT_CSV_COLUMNS = [
  'ServiceName',
  'FolderPath',
  'ServiceUrl',
  'Username',
  'CurrentPassword',
  'AliasEmail',
  'TwoFactorSecret',
  'AliasGender',
  'AliasFirstName',
  'AliasLastName',
  'AliasBirthDate',
  'CardholderName',
  'CardNumber',
  'CardExpiryMonth',
  'CardExpiryYear',
  'CardCvv',
  'CardPin',
  'Notes',
  'CreatedAt',
  'UpdatedAt',
] as const;

/** One column of the AliasVault CSV export. */
export type AliasVaultCsvColumn = (typeof ALIASVAULT_CSV_COLUMNS)[number];

/**
 * Exports items to the AliasVault CSV format.
 */
export class AliasVaultCsvExportService {
  /**
   * Export items to CSV.
   * @param items - The items to export, as read by the vault export
   * @param folders - The folders the items live in, to write each item's folder path
   * @returns The CSV file as UTF-8 bytes
   */
  public static exportItemsToCsv(items: ItemEntity[], folders: FolderEntity[] = []): Uint8Array {
    const foldersById = new Map(folders.filter(folder => !folder.IsDeleted).map(folder => [folder.Id, folder]));
    const rows = items.filter(item => !item.IsDeleted).map((item): string[] => {
      const fieldValues = item.FieldValues.filter(fv => !fv.IsDeleted).sort((a, b) => a.Weight - b.Weight);
      /**
       * All values of a system field, in order.
       */
      const values = (fieldKey: string): string[] => fieldValues.filter(fv => fv.FieldKey === fieldKey).map(fv => fv.Value ?? '');
      /**
       * A single field value, or the empty string when absent.
       */
      const field = (fieldKey: string): string => values(fieldKey)[0] ?? '';
      const record: Record<AliasVaultCsvColumn, string | Date | null> = {
        ServiceName: item.Name ?? '',
        FolderPath: AliasVaultCsvExportService.folderPath(item.FolderId, foldersById),
        ServiceUrl: values(FieldKey.LoginUrl).map(url => url.trim()).filter(url => url.length > 0).join(','),
        Username: field(FieldKey.LoginUsername),
        CurrentPassword: field(FieldKey.LoginPassword),
        AliasEmail: field(FieldKey.LoginEmail),
        TwoFactorSecret: AliasVaultCsvExportService.formatTwoFactorSecret(item.TotpCodes.find(code => !code.IsDeleted) ?? null),
        AliasGender: field(FieldKey.AliasGender),
        AliasFirstName: field(FieldKey.AliasFirstName),
        AliasLastName: field(FieldKey.AliasLastName),
        AliasBirthDate: AliasVaultCsvExportService.parseBirthDate(field(FieldKey.AliasBirthdate)),
        Notes: field(FieldKey.NotesContent),
        CardholderName: field(FieldKey.CardCardholderName),
        CardNumber: field(FieldKey.CardNumber),
        CardExpiryMonth: field(FieldKey.CardExpiryMonth),
        CardExpiryYear: field(FieldKey.CardExpiryYear),
        CardCvv: field(FieldKey.CardCvv),
        CardPin: field(FieldKey.CardPin),
        CreatedAt: item.CreatedAt,
        UpdatedAt: item.UpdatedAt,
      };

      return ALIASVAULT_CSV_COLUMNS.map(header => {
        const value = record[header];
        if (value instanceof Date) {
          return AliasVaultCsvExportService.formatDateTime(value);
        }
        return value ?? '';
      });
    });

    return new TextEncoder().encode(writeCsv([...ALIASVAULT_CSV_COLUMNS], rows));
  }

  /**
   * The "/"-joined names of a folder and its parents, root first.
   * @param folderId - The item's folder, or null for none
   * @param foldersById - The exported folders by id
   * @returns The folder path, or the empty string outside any folder
   */
  private static folderPath(folderId: string | null, foldersById: Map<string, FolderEntity>): string {
    const names: string[] = [];
    const visited = new Set<string>();
    for (let folder = folderId ? foldersById.get(folderId) : undefined; folder && !visited.has(folder.Id); folder = folder.ParentFolderId ? foldersById.get(folder.ParentFolderId) : undefined) {
      visited.add(folder.Id);
      names.unshift(folder.Name);
    }
    return names.join('/');
  }

  /**
   * Format an item's TOTP code for the single CSV secret column.
   * @param totpCode - The item's first live TOTP code, if any
   * @returns The secret or an otpauth:// URI
   */
  private static formatTwoFactorSecret(totpCode: TotpCodeEntity | null): string {
    if (!totpCode) {
      return '';
    }

    const algorithm = normalizeTotpAlgorithm(totpCode.Algorithm);
    const digits = normalizeTotpDigits(totpCode.Digits);
    const period = normalizeTotpPeriod(totpCode.Period);

    if (algorithm === TOTP_DEFAULT_ALGORITHM && digits === TOTP_DEFAULT_DIGITS && period === TOTP_DEFAULT_PERIOD) {
      return totpCode.SecretKey;
    }

    return formatTotpUri(totpCode, 'AliasVault');
  }

  /**
   * Format a date as "MM/dd/yyyy HH:mm:ss" (UTC), the date format of the CSV file.
   * @param date - The date
   * @returns The formatted date/time
   */
  private static formatDateTime(date: Date): string {
    /**
     * Two-digit zero-padded component.
     */
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  }

  /**
   * Parse a "yyyy-MM-dd" birth date.
   * @param birthDate - The birth date text
   * @returns The date, or null when empty or invalid
   */
  private static parseBirthDate(birthDate: string): Date | null {
    if (birthDate.length === 0) {
      return null;
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate.trim());
    return match ? parseDateExact(`${match[2]}/${match[3]}/${match[1]}`, 'MM/dd/yyyy') : null;
  }
}
