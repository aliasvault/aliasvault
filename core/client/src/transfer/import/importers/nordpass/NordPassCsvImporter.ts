import { ItemTypes } from '@aliasvault/models/vault';

import { isBlank, nonBlank, nullIfBlank } from '../../../shared/StringUtils';
import { readImportCsv } from '../../readers/CsvImport';
import { optionalText, text } from '../../readers/CsvRecordMapper';
import { mapItemType, parseUrls } from '../../readers/FieldParsers';

import type { ImportedCredential } from '../../models/ImportedCredential';
import type { ImportedCreditcard } from '../../models/ImportedCreditcard';

const COLUMNS = {
  name: text,
  url: text,
  username: text,
  password: text,
  note: optionalText,
  cardholdername: optionalText,
  cardnumber: optionalText,
  cvc: optionalText,
  pin: optionalText,
  expirydate: optionalText,
  folder: optionalText,
  email: optionalText,
  type: optionalText,
  custom_fields: optionalText,
};

const ITEM_TYPES = {
  password: ItemTypes.Login,
  note: ItemTypes.Note,
  credit_card: ItemTypes.CreditCard,
  identity: ItemTypes.Alias,
};

/**
 * Import a NordPass CSV export.
 * @param fileContent - The CSV file content
 * @returns The imported credentials
 */
export function importNordPassCsv(fileContent: string): ImportedCredential[] {
  return readImportCsv(fileContent, COLUMNS).filter(record => record.type?.toLowerCase() !== 'folder').map(record => {
    const hasCard = nonBlank([record.cardnumber, record.cardholdername, record.cvc, record.expirydate]).length > 0;
    const notes = isBlank(record.custom_fields) ? record.note : nonBlank([record.note]).concat(record.custom_fields).join('\n');

    return {
      ServiceName: record.name,
      ServiceUrls: parseUrls(record.url),
      Email: record.email,
      Username: record.username,
      Password: record.password,
      Notes: notes,
      FolderPath: nullIfBlank(record.folder),
      ItemType: mapItemType(record.type, ITEM_TYPES) ?? (hasCard ? ItemTypes.CreditCard : null),
      Creditcard: hasCard ? { CardholderName: record.cardholdername, Number: record.cardnumber, Cvv: record.cvc, Pin: record.pin, ...parseExpiryDate(record.expirydate) } : null,
    };
  });
}

/**
 * Parse a NordPass expiry date, written as "MM/YYYY", "MM/YY" or "MMYYYY", into month and year.
 * @param expiryDate - The expiry date text
 * @returns The month and year, empty when the format is not recognised
 */
function parseExpiryDate(expiryDate: string | null): Pick<ImportedCreditcard, 'ExpiryMonth' | 'ExpiryYear'> {
  if (expiryDate?.includes('/')) {
    const parts = expiryDate.split('/');
    return parts.length === 2 ? { ExpiryMonth: parts[0].trim().padStart(2, '0'), ExpiryYear: parts[1].trim() } : {};
  }
  if (expiryDate?.length === 6) {
    return { ExpiryMonth: expiryDate.substring(0, 2), ExpiryYear: expiryDate.substring(2) };
  }
  return {};
}
