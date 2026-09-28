import { isBlank, nullIfBlank } from '../../../shared/StringUtils';
import { readImportCsv } from '../../readers/CsvImport';
import { optionalText, text } from '../../readers/CsvRecordMapper';
import { parseUrls } from '../../readers/FieldParsers';

import type { ImportedCredential } from '../../models/ImportedCredential';

const COLUMNS = {
  service_name: text,
  url: optionalText,
  username: optionalText,
  password: optionalText,
  totp_secret: optionalText,
  notes: optionalText,
  folder: optionalText,
};

/** Common URL placeholders that are considered empty when found in the URL field. */
const URL_PLACEHOLDERS = new Set(['http://', 'https://', 'N/A', 'n/a']);

/** The template users download: the headers plus example rows. */
const CSV_TEMPLATE = [
  'service_name,url,username,password,totp_secret,notes,folder',
  'Gmail,https://gmail.com,your.email@gmail.com,your_password,,Important email account,Personal',
  'Facebook,https://facebook.com,your.username,your_password,,Social media account,Personal/Social',
  'GitHub,https://github.com,developer_username,your_password,your_totp_secret_here,Development platform,Work',
  'Secure Note,,,,,"Important information or notes without login credentials",',
].map(line => `${line}\r\n`).join('');

/**
 * The generic CSV template, for download.
 * @returns The UTF-8 encoded template
 */
export function getGenericCsvTemplate(): Uint8Array {
  return new TextEncoder().encode(CSV_TEMPLATE);
}

/**
 * Import a CSV file in the generic AliasVault template format.
 * @param fileContent - The CSV file content
 * @returns The imported credentials
 * @throws {Error} When the file holds no row with a service name.
 */
export function importGenericCsv(fileContent: string): ImportedCredential[] {
  const credentials = readImportCsv(fileContent, COLUMNS).filter(record => !isBlank(record.service_name)).map((record): ImportedCredential => {
    const url = nullIfBlank(record.url)?.trim() ?? null;
    return {
      ServiceName: record.service_name.trim(),
      ServiceUrls: url && !URL_PLACEHOLDERS.has(url) ? parseUrls(url) : null,
      Username: record.username?.trim() ?? null,
      Password: record.password?.trim() ?? null,
      TwoFactorSecret: record.totp_secret?.trim() ?? null,
      Notes: record.notes?.trim() ?? null,
      FolderPath: nullIfBlank(record.folder)?.trim() ?? null,
    };
  });

  if (credentials.length === 0) {
    throw new Error('No valid records found in the CSV file. Please ensure the CSV has the correct headers and at least one row with a service name.');
  }

  return credentials;
}
