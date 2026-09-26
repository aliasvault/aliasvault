import { ItemTypes } from '@aliasvault/models/vault';

import { isBlank, nullIfBlank } from '../../shared/StringUtils';
import { readImportCsv } from '../readers/CsvImport';
import { optionalText, text } from '../readers/CsvRecordMapper';

import { parseUrls } from './shared/CredentialHelpers';

import type { ImportedCredential } from '../models/ImportedCredential';

const COLUMNS = {
  Name: text,
  Url: optionalText,
  Login: optionalText,
  Pwd: optionalText,
  Note: optionalText,
  Folder: optionalText,
};

/**
 * Import a RoboForm CSV export. A item with a note but no URL, login or password is a secure note.
 * @param fileContent - The CSV file content
 * @returns The imported credentials
 */
export function importRoboformCsv(fileContent: string): ImportedCredential[] {
  return readImportCsv(fileContent, COLUMNS).map(record => ({
    ServiceName: record.Name,
    ServiceUrls: parseUrls(record.Url),
    Username: record.Login,
    Password: record.Pwd,
    Notes: record.Note,
    FolderPath: nullIfBlank(record.Folder?.replace(/^\/+/, '')),
    ItemType: isBlank(record.Url) && isBlank(record.Login) && isBlank(record.Pwd) && !isBlank(record.Note) ? ItemTypes.Note : ItemTypes.Login,
  }));
}
