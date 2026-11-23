import { FieldKey, getFieldValue, type Item } from '@aliasvault/models/vault';

import { scopedKey, type ItemRef } from '../../../database/ItemRef';
import { parseFolderPath } from '../../shared/FolderPaths';

import { isEmptyEnrichment, type ItemEnrichment } from './ItemEnrichment';

import type { ImportedCredential } from '../models/ImportedCredential';

/**
 * A parsed credential that completes an item the vault already holds.
 */
export type ImportEnrichment = {
  credential: ImportedCredential;
  target: ItemRef;
  additions: ItemEnrichment;
};

/**
 * Determines what a credential adds to a vault item it matches; null or an empty enrichment means nothing.
 */
export type EnrichmentPlanner = (existing: Item, imported: ImportedCredential) => ItemEnrichment | null;

/**
 * Import preview stats.
 */
export type ImportPreview = {
  credentials: ImportedCredential[];
  enrichments: ImportEnrichment[];
  duplicateCount: number;
  folderPaths: string[];
  attachmentCount: number;
  attachmentsTotalSize: number;
};

/**
 * Sort the parsed credentials into new ones, updates to existing ones, and duplicates that are dropped.
 * @param existingItems - The items already in the vault
 * @param credentials - The parsed credentials
 * @param planEnrichment - Determines what a credential adds to an existing item it matches
 * @returns The preview
 */
export function detectAndRemoveDuplicates(existingItems: Item[], credentials: ImportedCredential[], planEnrichment: EnrichmentPlanner): ImportPreview {
  const remaining: ImportedCredential[] = [];
  const enrichments: ImportEnrichment[] = [];
  const enrichedItemKeys = new Set<string>();
  let duplicateCount = 0;
  let attachmentCount = 0;
  let attachmentsTotalSize = 0;

  /**
   * Count the attachments an import writes.
   */
  const countAttachments = (attachments: { Blob?: Uint8Array | null }[]): void => {
    for (const attachment of attachments) {
      attachmentCount++;
      attachmentsTotalSize += attachment.Blob?.length ?? 0;
    }
  };

  for (const credential of credentials) {
    const matches = existingItems.filter(existing => isDuplicateItem(existing, credential));
    if (matches.length === 0) {
      remaining.push(credential);
      countAttachments(credential.Attachments ?? []);
      continue;
    }

    const plans = matches.map(item => ({ item, enrichment: planEnrichment(item, credential) }));
    const target = plans.some(plan => !plan.enrichment || isEmptyEnrichment(plan.enrichment)) ? undefined : plans.find(plan => !enrichedItemKeys.has(scopedKey(plan.item.ManifestId, plan.item.Id)));
    if (!target?.enrichment) {
      duplicateCount++;
      continue;
    }

    enrichedItemKeys.add(scopedKey(target.item.ManifestId, target.item.Id));
    enrichments.push({ credential, target: { Id: target.item.Id, ManifestId: target.item.ManifestId }, additions: target.enrichment });
    countAttachments(target.enrichment.Attachments);
  }

  return {
    credentials: remaining,
    enrichments,
    duplicateCount,
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
 * Whether an imported credential is the same entry as an item already in the vault.
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
