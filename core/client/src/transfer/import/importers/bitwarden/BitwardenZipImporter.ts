import { isBlank } from '../../../shared/StringUtils';
import { openArchive, readArchiveJson } from '../../readers/ArchiveImport';
import { isJsonObject, readString } from '../../readers/JsonReader';
import { rustPasskeyKeys, type PasskeyKeyConverter } from '../../readers/PasskeyImport';

import { parseBitwardenJsonExport } from './BitwardenJson';
import { importBitwardenExport } from './BitwardenJsonImporter';

import type { ImportFileResult } from '../../models/ImportFileResult';

const ATTACHMENTS_PATH = 'attachments/';

/**
 * Import a Bitwarden .zip export: data.json, with the passkeys of its logins, plus the attachments stored in a folder per item.
 * @param archiveBytes - The archive bytes
 * @param keys - Converts passkey keys, the Rust core by default
 * @returns The credentials and the items that could not be read
 * @throws {ImportException} When the archive cannot be opened, data.json cannot be read or the export is encrypted.
 */
export async function importBitwardenZip(archiveBytes: Uint8Array, keys: PasskeyKeyConverter = rustPasskeyKeys): Promise<ImportFileResult> {
  const archive = openArchive(archiveBytes);
  const exportData = parseBitwardenJsonExport(readArchiveJson(archive, 'data.json'));
  const attachmentFolders = matchAttachmentFolders(exportData.Items, readAttachmentFolders(archive.filesUnder(ATTACHMENTS_PATH)));
  return importBitwardenExport(exportData, keys, element => attachmentFolders.get(element));
}

/**
 * Group the attachment files by their folder, the first path part below "attachments/".
 * @param files - The files under "attachments/"
 * @returns The files (file name to bytes) by folder name
 */
function readAttachmentFolders(files: Map<string, Uint8Array>): Map<string, Map<string, Uint8Array>> {
  const folders = new Map<string, Map<string, Uint8Array>>();
  for (const [path, data] of files) {
    const relative = path.substring(ATTACHMENTS_PATH.length);
    const separator = relative.indexOf('/');
    if (separator <= 0 || separator === relative.length - 1) {
      continue;
    }
    const folder = relative.substring(0, separator);
    const folderFiles = folders.get(folder) ?? new Map<string, Uint8Array>();
    folderFiles.set(relative.substring(separator + 1), data);
    folders.set(folder, folderFiles);
  }
  return folders;
}

/**
 * Find the attachment folder of each item: attachments/<item name>/, or attachments/<item id>/ when that folder exists.
 * @param items - The items as raw JSON, in export order
 * @param folders - The attachment files by folder name
 * @returns The attachment files of each item that has any, keyed by its raw JSON
 */
function matchAttachmentFolders(items: unknown[], folders: Map<string, Map<string, Uint8Array>>): Map<unknown, Map<string, Uint8Array>> {
  const matches = new Map<unknown, Map<string, Uint8Array>>();
  const foldersByLowerName = new Map([...folders].map(([name, files]) => [name.toLowerCase(), files]));
  const nameCounts = new Map<string, number>();
  for (const element of items) {
    if (!isJsonObject(element)) {
      continue;
    }

    const id = readString(element, 'id');
    const byId = isBlank(id) ? undefined : foldersByLowerName.get(id.toLowerCase());
    if (byId) {
      matches.set(element, byId);
      continue;
    }

    /*
     * The folder is the item name with /\><:"|?* replaced by "_", plus "_1", "_2" for later items with
     * the same name. Only items with attachments count for that suffix and data.json does not say which have any,
     * so same-named items take the numbered folders in export order.
     */
    const name = readString(element, 'name');
    if (name === null) {
      continue;
    }
    const count = nameCounts.get(name) ?? 0;
    const folderName = name.replace(/[/\\><:"|?*]/g, '_').replace(/__+/g, '_') + (count > 0 ? `_${count}` : '');
    const byName = folders.get(folderName);
    if (byName) {
      matches.set(element, byName);
      nameCounts.set(name, count + 1);
    }
  }
  return matches;
}
