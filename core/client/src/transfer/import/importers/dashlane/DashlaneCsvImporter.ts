import { nullIfBlank } from '../../../shared/StringUtils';
import { readImportCsv } from '../../readers/CsvImport';
import { optionalText, text } from '../../readers/CsvRecordMapper';
import { parseUrls } from '../../readers/FieldParsers';

import type { ImportedCredential } from '../../models/ImportedCredential';

const COLUMNS = {
  username: text,
  username2: optionalText,
  username3: optionalText,
  title: text,
  password: optionalText,
  note: optionalText,
  url: optionalText,
  category: optionalText,
  otpUrl: optionalText,
};

/**
 * Import a Dashlane CSV export.
 * @param fileContent - The CSV file content
 * @returns The imported credentials
 */
export function importDashlaneCsv(fileContent: string): ImportedCredential[] {
  return readImportCsv(fileContent, COLUMNS).map(record => {
    // The alternative usernames are kept in the notes.
    const notes = [
      record.note,
      record.username2 && `Alternative username 1: ${record.username2}`,
      record.username3 && `Alternative username 2: ${record.username3}`,
    ].filter(line => !!line);

    return {
      ServiceName: record.title,
      ServiceUrls: parseUrls(record.url),
      Username: record.username,
      Password: record.password,
      TwoFactorSecret: record.otpUrl,
      Notes: notes.length > 0 ? notes.join('\n') : null,
      // The Dashlane category becomes the folder.
      FolderPath: nullIfBlank(record.category),
    };
  });
}
