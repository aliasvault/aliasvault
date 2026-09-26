import { FieldKey, getFieldValue, getFieldValues, normalizeTotpAlgorithm, normalizeTotpDigits, normalizeTotpPeriod, TOTP_DEFAULT_ALGORITHM, TOTP_DEFAULT_DIGITS, TOTP_DEFAULT_PERIOD } from '@aliasvault/models/vault';

import { fromStandardFormat } from '../../utilities/DateFormatter';
import { parseDateExact } from '../shared/DateTimeUtils';

import { writeCsv } from './CsvWriter';

import type { Item, TotpCode } from '@aliasvault/models/vault';

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
   * @param getTotpCodes - Reads an item's TOTP codes; the first one is exported
   * @returns The CSV file as UTF-8 bytes
   */
  public static exportItemsToCsv(items: Item[], getTotpCodes: (item: Item) => TotpCode[] = (): TotpCode[] => []): Uint8Array {
    const rows = items.map((item): string[] => {
      /**
       *
       */
      /**
       * A single field value, or the empty string when absent.
       */
      const field = (fieldKey: string): string => getFieldValue(item, fieldKey) ?? '';
      const record: Record<ItemCsvColumn, string | Date | null> = {
        ServiceName: item.Name ?? '',
        FolderPath: item.FolderPath?.join('/') ?? '',
        ServiceUrl: getFieldValues(item, FieldKey.LoginUrl).map(url => url.trim()).filter(url => url.length > 0).join(','),
        Username: field(FieldKey.LoginUsername),
        CurrentPassword: field(FieldKey.LoginPassword),
        AliasEmail: field(FieldKey.LoginEmail),
        TwoFactorSecret: ItemCsvExportService.formatTwoFactorSecret(getTotpCodes(item)[0] ?? null),
        AliasGender: field(FieldKey.AliasGender),
        AliasFirstName: field(FieldKey.AliasFirstName),
        AliasLastName: field(FieldKey.AliasLastName),
        AliasBirthDate: ItemCsvExportService.parseBirthDate(field(FieldKey.AliasBirthdate)),
        Notes: field(FieldKey.NotesContent),
        CardholderName: field(FieldKey.CardCardholderName),
        CardNumber: field(FieldKey.CardNumber),
        CardExpiryMonth: field(FieldKey.CardExpiryMonth),
        CardExpiryYear: field(FieldKey.CardExpiryYear),
        CardCvv: field(FieldKey.CardCvv),
        CardPin: field(FieldKey.CardPin),
        CreatedAt: fromStandardFormat(item.CreatedAt),
        UpdatedAt: fromStandardFormat(item.UpdatedAt),
      };

      return ITEM_CSV_COLUMNS.map(header => {
        const value = record[header];
        if (value instanceof Date) {
          return ItemCsvExportService.formatDateTime(value);
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
  private static formatTwoFactorSecret(totpCode: TotpCode | null): string {
    if (!totpCode) {
      return '';
    }

    const algorithm = normalizeTotpAlgorithm(totpCode.Algorithm);
    const digits = normalizeTotpDigits(totpCode.Digits);
    const period = normalizeTotpPeriod(totpCode.Period);

    if (algorithm === TOTP_DEFAULT_ALGORITHM && digits === TOTP_DEFAULT_DIGITS && period === TOTP_DEFAULT_PERIOD) {
      return totpCode.SecretKey;
    }

    const name = totpCode.Name ?? '';
    const label = encodeURIComponent(name.trim().length === 0 ? 'AliasVault' : name);
    return `otpauth://totp/${label}?secret=${totpCode.SecretKey}&algorithm=${algorithm}&digits=${digits}&period=${period}`;
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
