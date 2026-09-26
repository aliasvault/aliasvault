import { parseDateTime } from '../../shared/DateTimeUtils';

import { parseCsvRows } from './CsvParser';

/**
 * Reads one column's text into a value; the text is undefined when the file lacks the column.
 */
export type CsvColumn<T> = (raw: string | undefined) => T;

/**
 * The columns of a record, keyed by their header.
 */
export type CsvColumns = Record<string, CsvColumn<unknown>>;

/**
 * The record type the columns read into.
 */
export type CsvRecord<C extends CsvColumns> = { [K in keyof C]: ReturnType<C[K]> };

/**
 * A text column; the empty string when the file lacks it.
 * @param raw - The column text
 * @returns The text
 */
export const text: CsvColumn<string> = (raw: string | undefined): string => raw ?? '';

/**
 * A text column; null when the file lacks it.
 * @param raw - The column text
 * @returns The text, or null
 */
export const optionalText: CsvColumn<string | null> = (raw: string | undefined): string | null => raw ?? null;

/**
 * A date/time column; null when absent, blank or unparseable.
 * @param raw - The column text
 * @returns The date, or null
 */
export const dateTime: CsvColumn<Date | null> = (raw: string | undefined): Date | null => parseDateTime(raw);

/**
 * Read typed records from CSV text with a header row. Each column is found by its key; columns the file lacks read
 * as undefined, extra columns are ignored and the first of two columns with the same header wins.
 * @param content - The CSV text
 * @param columns - The columns to read, keyed by header
 * @param normalizeHeader - Applied to both sides before headers are matched; exact matching by default
 * @returns The records, one per data row
 */
export function readCsvRecords<C extends CsvColumns>(content: string, columns: C, normalizeHeader: (header: string) => string = (header): string => header): CsvRecord<C>[] {
  const [headerRow, ...dataRows] = parseCsvRows(content);
  if (!headerRow) {
    return [];
  }

  const headerIndexes = new Map<string, number>();
  headerRow.forEach((header, index) => {
    const key = normalizeHeader(header);
    if (!headerIndexes.has(key)) {
      headerIndexes.set(key, index);
    }
  });

  const indexedColumns = Object.entries(columns).map(([key, read]) => ({ key, read, index: headerIndexes.get(normalizeHeader(key)) }));
  return dataRows.map(row => {
    const record: Record<string, unknown> = {};
    for (const { key, read, index } of indexedColumns) {
      record[key] = read(index === undefined ? undefined : row[index]);
    }
    return record as CsvRecord<C>;
  });
}
