import { ItemTypes } from '@aliasvault/models/vault';

import { nullIfBlank } from '../../../shared/StringUtils';
import { dateTime, readCsvRecords, text, type CsvColumn, type CsvRecord } from '../../readers/CsvRecordMapper';
import { parseUrls } from '../shared/CredentialHelpers';

import type { ItemCsvColumn } from '../../../export/ItemCsvExportService';
import type { ImportedCredential } from '../../models/ImportedCredential';

/** How each column of the AliasVault CSV export is read. */
const COLUMNS = {
  ServiceName: text,
  FolderPath: text,
  ServiceUrl: text,
  Username: text,
  CurrentPassword: text,
  AliasEmail: text,
  TwoFactorSecret: text,
  AliasGender: text,
  AliasFirstName: text,
  AliasLastName: text,
  AliasBirthDate: dateTime,
  CardholderName: text,
  CardNumber: text,
  CardExpiryMonth: text,
  CardExpiryYear: text,
  CardCvv: text,
  CardPin: text,
  Notes: text,
  CreatedAt: dateTime,
  UpdatedAt: dateTime,
} satisfies Record<ItemCsvColumn, CsvColumn<unknown>>;

/**
 * A row of the AliasVault CSV export.
 */
type ItemCsvRecord = CsvRecord<typeof COLUMNS>;

/**
 * Imports items from the AliasVault CSV format.
 */
export class ItemCsvImportService {
  /**
   * Import items from an AliasVault CSV file.
   * @param fileContent - The CSV file content
   * @returns The imported credentials
   * @throws {Error} When the file holds no records.
   */
  public static importItemsFromCsv(fileContent: string): ImportedCredential[] {
    // Columns the file lacks are skipped (older exports have no card columns).
    const records = readCsvRecords(fileContent, COLUMNS);

    if (records.length === 0) {
      throw new Error('No records found in the CSV file.');
    }

    return records.map((record): ImportedCredential => {
      const credential: ImportedCredential = {
        ServiceName: record.ServiceName,
        ServiceUrls: parseUrls(record.ServiceUrl),
        Username: record.Username,
        Password: record.CurrentPassword,
        Email: record.AliasEmail,
        Notes: record.Notes,
        Alias: {
          Gender: record.AliasGender,
          FirstName: record.AliasFirstName,
          LastName: record.AliasLastName,
          BirthDate: record.AliasBirthDate,
        },
        TwoFactorSecret: record.TwoFactorSecret,
        CreatedAt: record.CreatedAt,
        UpdatedAt: record.UpdatedAt,
        FolderPath: nullIfBlank(record.FolderPath),
      };

      if (ItemCsvImportService.hasCardData(record)) {
        credential.ItemType = ItemTypes.CreditCard;
        credential.Creditcard = {
          CardholderName: record.CardholderName,
          Number: record.CardNumber,
          ExpiryMonth: record.CardExpiryMonth,
          ExpiryYear: record.CardExpiryYear,
          Cvv: record.CardCvv,
          Pin: record.CardPin,
        };
      }

      return credential;
    });
  }

  /**
   * Whether a record has any credit card column filled.
   * @param record - The record
   * @returns True when a card field has a value
   */
  private static hasCardData(record: ItemCsvRecord): boolean {
    return [record.CardholderName, record.CardNumber, record.CardExpiryMonth, record.CardExpiryYear, record.CardCvv, record.CardPin].some(value => value.trim().length > 0);
  }
}
