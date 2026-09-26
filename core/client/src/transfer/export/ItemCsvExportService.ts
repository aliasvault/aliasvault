import { FieldKey, normalizeTotpAlgorithm, normalizeTotpDigits, normalizeTotpPeriod, TOTP_DEFAULT_ALGORITHM, TOTP_DEFAULT_DIGITS, TOTP_DEFAULT_PERIOD } from '@aliasvault/models/vault';

import { formatInvariantDateTime, parseDateExact } from '../shared/DateTimeUtils';
import { buildFolderPath } from '../shared/FolderPaths';

import { writeCsv } from './CsvWriter';

import type { FolderEntity, ItemEntity, TotpCodeEntity } from '../shared/VaultEntities';

/** The columns of the AliasVault CSV export. */
export const ITEM_CSV_COLUMNS = [
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
export type ItemCsvColumn = (typeof ITEM_CSV_COLUMNS)[number];

/**
 * Exports items to the AliasVault CSV format.
 */
export class ItemCsvExportService {
  /**
   * Export items to CSV.
   * @param items - The items to export
   * @param folders - The vault's folders, to resolve each item's folder path
   * @returns The CSV file as UTF-8 bytes
   */
  public static exportItemsToCsv(items: ItemEntity[], folders: FolderEntity[] = []): Uint8Array {
    const foldersById = new Map(folders.map(folder => [folder.Id, folder]));

    const rows = items.map((item): string[] => {
      const record: Record<ItemCsvColumn, string | Date | null> = {
        ServiceName: item.Name ?? '',
        FolderPath: buildFolderPath(item.FolderId, foldersById),
        ServiceUrl: ItemCsvExportService.getJoinedFieldValues(item, FieldKey.LoginUrl),
        Username: ItemCsvExportService.getFieldValue(item, FieldKey.LoginUsername),
        CurrentPassword: ItemCsvExportService.getFieldValue(item, FieldKey.LoginPassword),
        AliasEmail: ItemCsvExportService.getFieldValue(item, FieldKey.LoginEmail),
        TwoFactorSecret: ItemCsvExportService.formatTwoFactorSecret(item.TotpCodes.find(t => !t.IsDeleted) ?? null),
        AliasGender: ItemCsvExportService.getFieldValue(item, FieldKey.AliasGender),
        AliasFirstName: ItemCsvExportService.getFieldValue(item, FieldKey.AliasFirstName),
        AliasLastName: ItemCsvExportService.getFieldValue(item, FieldKey.AliasLastName),
        AliasBirthDate: ItemCsvExportService.parseBirthDate(ItemCsvExportService.getFieldValue(item, FieldKey.AliasBirthdate)),
        Notes: ItemCsvExportService.getFieldValue(item, FieldKey.NotesContent),
        CardholderName: ItemCsvExportService.getFieldValue(item, FieldKey.CardCardholderName),
        CardNumber: ItemCsvExportService.getFieldValue(item, FieldKey.CardNumber),
        CardExpiryMonth: ItemCsvExportService.getFieldValue(item, FieldKey.CardExpiryMonth),
        CardExpiryYear: ItemCsvExportService.getFieldValue(item, FieldKey.CardExpiryYear),
        CardCvv: ItemCsvExportService.getFieldValue(item, FieldKey.CardCvv),
        CardPin: ItemCsvExportService.getFieldValue(item, FieldKey.CardPin),
        CreatedAt: item.CreatedAt,
        UpdatedAt: item.UpdatedAt,
      };

      return ITEM_CSV_COLUMNS.map(header => {
        const value = record[header];
        if (value instanceof Date) {
          return formatInvariantDateTime(value);
        }
        return value ?? '';
      });
    });

    return new TextEncoder().encode(writeCsv([...ITEM_CSV_COLUMNS], rows));
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

    const label = encodeURIComponent(totpCode.Name.trim().length === 0 ? 'AliasVault' : totpCode.Name);
    return `otpauth://totp/${label}?secret=${totpCode.SecretKey}&algorithm=${algorithm}&digits=${digits}&period=${period}`;
  }

  /**
   * A single field value of an item.
   * @param item - The item
   * @param fieldKey - The field key
   * @returns The value, or the empty string when absent
   */
  private static getFieldValue(item: ItemEntity, fieldKey: string): string {
    return item.FieldValues.find(fv => fv.FieldKey === fieldKey && !fv.IsDeleted)?.Value ?? '';
  }

  /**
   * All values of a multi-value field as one comma separated string, ordered by weight.
   * @param item - The item
   * @param fieldKey - The field key
   * @returns The joined values, or the empty string when there are none
   */
  private static getJoinedFieldValues(item: ItemEntity, fieldKey: string): string {
    return item.FieldValues
      .filter(fv => fv.FieldKey === fieldKey && !fv.IsDeleted && !!fv.Value && fv.Value.trim().length > 0)
      .sort((a, b) => a.Weight - b.Weight)
      .map(fv => fv.Value!.trim())
      .join(',');
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
