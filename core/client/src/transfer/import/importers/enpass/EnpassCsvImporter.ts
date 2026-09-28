import { ItemTypes, type ItemType } from '@aliasvault/models/vault';

import { parseDateExact, parseDateTime } from '../../../shared/DateTimeUtils';
import { isBlank } from '../../../shared/StringUtils';
import { parseCsvRows } from '../../readers/CsvParser';
import { parseUrls } from '../../readers/FieldParsers';

import type { ImportedAlias } from '../../models/ImportedAlias';
import type { ImportedCredential } from '../../models/ImportedCredential';
import type { ImportedCreditcard } from '../../models/ImportedCreditcard';

/**
 * The fields of one Enpass row, looked up case-insensitively.
 */
class EnpassFields {
  /** Lower case field names to values; the first occurrence of a name wins. */
  public readonly values = new Map<string, string>();

  /**
   * Collect the name/value pairs that follow the item name. Pairs with an empty name or value are skipped, and a
   * leading asterisk (Enpass's marker for sensitive fields) is dropped from the name.
   * @param fields - The row's fields, starting with the item name
   */
  public constructor(fields: string[]) {
    for (let i = 1; i < fields.length - 1; i += 2) {
      const name = fields[i].trim().replace(/^\*/, '').toLowerCase();
      if (name.length > 0 && !isBlank(fields[i + 1]) && !this.values.has(name)) {
        this.values.set(name, fields[i + 1]);
      }
    }
  }

  /**
   * Whether a field is present.
   * @param name - The field name
   * @returns True when present
   */
  public has(name: string): boolean {
    return this.values.has(name.toLowerCase());
  }

  /**
   * The value of the first of the names that is present.
   * @param names - The field names to try, in order
   * @returns The value, or null
   */
  public first(...names: string[]): string | null {
    for (const name of names) {
      const value = this.values.get(name.toLowerCase());
      if (value !== undefined) {
        return value;
      }
    }
    return null;
  }
}

/** Fields that have no credential property of their own and are kept in the notes as "Name: value". */
const NOTE_FIELDS = ['Note', 'Notes', 'Security question', 'Security answer', 'Secret question', 'Secret answer'];

/** Birth date layouts tried when the generic date parser fails. */
const BIRTH_DATE_FORMATS = ['dd-MM-yyyy', 'MM-dd-yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy'] as const;

/**
 * Import an Enpass CSV export. Enpass writes no header row: each row is the item name followed by alternating
 * field name and value pairs, and the item type follows from the name and the fields present.
 * @param fileContent - The CSV file content
 * @returns The imported credentials
 */
export function importEnpassCsv(fileContent: string): ImportedCredential[] {
  return parseCsvRows(fileContent).filter(row => row.length > 0).map(parseRow);
}

/**
 * Parse one Enpass row.
 * @param row - The row's fields
 * @returns The credential
 */
function parseRow(row: string[]): ImportedCredential {
  const itemName = row[0];
  const fields = new EnpassFields(row);
  const itemType = determineItemType(itemName, fields);

  return {
    ServiceName: itemName,
    ItemType: itemType,
    Username: fields.first('Username', 'Login', 'E-mail'),
    Password: fields.first('Password', 'Login password'),
    Email: fields.first('E-mail', 'Email'),
    // A secure note row holds only the name and the note text.
    Notes: itemType === ItemTypes.Note && row.length === 2 ? row[1] : buildNotes(fields),
    ServiceUrls: parseUrls(fields.first('Website', 'URL')),
    TwoFactorSecret: fields.first('One-time code', 'TOTP', 'OTP'),
    Creditcard: itemType === ItemTypes.CreditCard ? parseCreditCard(fields) : undefined,
    Alias: itemType === ItemTypes.Alias ? parseAlias(fields) : undefined,
  };
}

/**
 * Determine the item type from the item name and the fields present.
 * @param itemName - The item name
 * @param fields - The row's fields
 * @returns The item type
 */
function determineItemType(itemName: string, fields: EnpassFields): ItemType {
  const name = itemName.toLowerCase();
  if (name.includes('credit card') || name.includes('creditcard') || fields.has('CVC') || fields.has('Cardholder')) {
    return ItemTypes.CreditCard;
  }
  if (name === 'identity' || fields.has('First name') || fields.has('Social Security Number')) {
    return ItemTypes.Alias;
  }
  if (name === 'securenote' || name === 'secure note' || name === 'note') {
    return ItemTypes.Note;
  }
  return ItemTypes.Login;
}

/**
 * Build the notes from the fields that do not map to a credential property.
 * @param fields - The row's fields
 * @returns The notes, or null
 */
function buildNotes(fields: EnpassFields): string | null {
  const notes = NOTE_FIELDS.filter(name => fields.has(name)).map(name => `${name}: ${fields.first(name)}`);
  for (const [name, value] of fields.values) {
    if (name.endsWith('notes')) {
      notes.push(value);
    }
  }
  return notes.length > 0 ? notes.join('\n') : null;
}

/**
 * Parse the credit card fields. The expiry is MM/YY or MM/YYYY; a four-digit year keeps its last two digits.
 * @param fields - The row's fields
 * @returns The credit card
 */
function parseCreditCard(fields: EnpassFields): ImportedCreditcard {
  const card: ImportedCreditcard = {
    CardholderName: fields.first('Cardholder', 'Cardholder Name', 'Name on Card'),
    Number: fields.first('Number', 'Card Number'),
    Cvv: fields.first('CVC', 'CVV', 'Security Code'),
    Pin: fields.first('PIN'),
  };

  const parts = fields.first('Expiry date', 'Expiry', 'Expires', 'Valid thru')?.split('/') ?? [];
  if (parts.length === 2) {
    const year = parts[1].trim();
    card.ExpiryMonth = parts[0].trim();
    card.ExpiryYear = year.length === 4 ? year.substring(2) : year;
  }

  return card;
}

/**
 * Parse the identity fields.
 * @param fields - The row's fields
 * @returns The alias
 */
function parseAlias(fields: EnpassFields): ImportedAlias {
  const alias: ImportedAlias = {
    FirstName: fields.first('First name', 'Firstname'),
    LastName: fields.first('Last name', 'Lastname'),
    Gender: fields.first('Gender'),
  };

  const birthDate = fields.first('Birth date', 'Birthdate', 'Birthday', 'Date of birth');
  if (birthDate) {
    const date = parseDateTime(birthDate) ?? BIRTH_DATE_FORMATS.map(format => parseDateExact(birthDate, format)).find(parsed => parsed !== null);
    if (date) {
      alias.BirthDate = date;
    }
  }

  return alias;
}
