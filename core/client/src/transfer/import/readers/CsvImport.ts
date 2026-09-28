import { readCsvRecords, type CsvColumns, type CsvRecord } from './CsvRecordMapper';

/**
 * Decode uploaded file bytes into text.
 * @param fileBytes - The raw bytes of the uploaded file
 * @returns The decoded file content
 */
export function decodeFileContent(fileBytes: Uint8Array): string {
  if (fileBytes[0] === 0xFF && fileBytes[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(fileBytes);
  }
  if (fileBytes[0] === 0xFE && fileBytes[1] === 0xFF) {
    return new TextDecoder('utf-16be').decode(fileBytes);
  }
  return new TextDecoder('utf-8').decode(fileBytes);
}

/**
 * Read the records of a password manager's CSV export. Headers match ignoring case and spaces, and every
 * non-empty text field is passed through the optional field decoder.
 * @param fileContent - The CSV file content
 * @param columns - The columns to read
 * @param decodeField - Decodes one text field, for exports with their own escaping on top of CSV
 * @returns The records
 * @throws {Error} When the file holds no records.
 */
export function readImportCsv<C extends CsvColumns>(fileContent: string, columns: C, decodeField?: (value: string) => string): CsvRecord<C>[] {
  const records = readCsvRecords(fileContent, columns, header => header.toLowerCase().trim().replace(/ /g, ''));
  if (records.length === 0) {
    throw new Error('No records found in the CSV file.');
  }
  if (!decodeField) {
    return records;
  }

  for (const record of records) {
    const fields = record as Record<string, unknown>;
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === 'string' && value.length > 0) {
        fields[key] = decodeField(value);
      }
    }
  }
  return records;
}
