import { FieldKey, getFieldValue, type Item } from '@aliasvault/models/vault';

import { parseFolderPath } from '../../shared/FolderPaths';

import type { ImportedCredential } from '../models/ImportedCredential';

/**
 * What the import preview learned about a parsed file, once duplicates of credentials already in the vault are dropped.
 */
export type ImportPreview = {
  credentials: ImportedCredential[];
  duplicateCount: number;
  folderPaths: string[];
  attachmentCount: number;
  attachmentsTotalSize: number;
};

/**
 * Drop the credentials the vault already contains based on a duplicate check.
 * @param existingItems - The items already in the vault
 * @param credentials - The parsed credentials
 * @returns The preview
 */
export function detectAndRemoveDuplicates(existingItems: Item[], credentials: ImportedCredential[]): ImportPreview {
  const duplicates = new Set(credentials.filter(imported => existingItems.some(existing => isDuplicateItem(existing, imported))));
  const remaining = credentials.filter(credential => !duplicates.has(credential));

  let attachmentCount = 0;
  let attachmentsTotalSize = 0;
  for (const credential of remaining) {
    for (const attachment of credential.Attachments ?? []) {
      attachmentCount++;
      attachmentsTotalSize += attachment.Blob?.length ?? 0;
    }
  }

  return {
    credentials: remaining,
    duplicateCount: duplicates.size,
    folderPaths: collectHierarchicalFolderPaths(remaining),
    attachmentCount,
    attachmentsTotalSize,
  };
}

/**
 * Every unique folder path of the credentials including the ones that would be created: "Root/Business/Banking" and
 * "Root/Personal" give ["Root", "Root/Business", "Root/Business/Banking", "Root/Personal"], parents first.
 * @param credentials - The credentials
 * @returns The folder paths in creation order
 */
export function collectHierarchicalFolderPaths(credentials: ImportedCredential[]): string[] {
  const seen = new Set<string>();
  const pathsWithDepth: { path: string; depth: number }[] = [];

  for (const credential of credentials) {
    const parts = parseFolderPath(credential.FolderPath);
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join('/');
      const key = path.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        pathsWithDepth.push({ path, depth: i });
      }
    }
  }

  // Parents before children, then alphabetically.
  return pathsWithDepth
    .sort((a, b) => a.depth - b.depth || a.path.toLowerCase().localeCompare(b.path.toLowerCase()))
    .map(entry => entry.path);
}

/**
 * Whether an imported credential duplicates an item already in the vault.
 * @param existing - The vault item
 * @param imported - The imported credential
 * @returns True when title, folder path, username, password and notes all match
 */
export function isDuplicateItem(existing: Item, imported: ImportedCredential): boolean {
  if (!existing.Name || existing.Name.toLowerCase() !== (imported.ServiceName ?? '').toLowerCase()) {
    return false;
  }

  const existingFolderPath = existing.FolderPath?.join('/') ?? '';
  const importedFolderPath = imported.FolderPath ?? '';
  if (existingFolderPath.toLowerCase() !== importedFolderPath.toLowerCase()) {
    return false;
  }

  if (!fieldValuesMatch(getFieldValue(existing, FieldKey.LoginUsername), imported.Username)) {
    return false;
  }

  if (!fieldValuesMatch(getFieldValue(existing, FieldKey.LoginPassword), imported.Password)) {
    return false;
  }

  return notesFieldsMatch(getFieldValue(existing, FieldKey.NotesContent), imported.Notes);
}

/**
 * Compare two field values.
 * @param existingValue - The vault value
 * @param importedValue - The imported value
 * @returns True when they match
 */
function fieldValuesMatch(existingValue: string | null | undefined, importedValue: string | null | undefined): boolean {
  const existingHasValue = !!existingValue;
  const importedHasValue = !!importedValue;

  if (existingHasValue && importedHasValue) {
    return existingValue.toLowerCase() === importedValue.toLowerCase();
  }

  return !existingHasValue && !importedHasValue;
}
  
/**
 * Compare two notes.
 * @param existingNotes - The vault notes
 * @param importedNotes - The imported notes
 * @returns True when they match
 */
function notesFieldsMatch(existingNotes: string | null | undefined, importedNotes: string | null | undefined): boolean {
  const existingHasValue = !!existingNotes;
  const importedHasValue = !!importedNotes;

  if (!existingHasValue && !importedHasValue) {
    return true;
  }

  if (existingHasValue !== importedHasValue) {
    return false;
  }

  return existingNotes!.toLowerCase().includes(importedNotes!.toLowerCase());
}
