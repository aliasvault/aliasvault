import { FieldKey, ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { readFixtureText, byName, itemByName } from '../../../__tests__/testHelpers';
import { collectHierarchicalFolderPaths } from '../../../writers/ImportDuplicateDetection';
import { convertToItems } from '../../../writers/ItemConverter';
import { importRoboformCsv } from '../RoboformCsvImporter';

describe('RoboformCsvImporter', () => {
  it('imports RoboForm CSV', () => {
    const imported = importRoboformCsv(readFixtureText(import.meta.dirname, 'roboform.csv'));
    expect(imported).toHaveLength(5);

    const com = byName(imported, 'Com');
    expect(com.ServiceUrls?.[0]).toBe('https://www.example.com.com');
    expect(com.Username).toBe('username1');
    expect(com.Password).toBe('password1');
    expect(com.Notes ?? '').toBe('');
    expect(com.FolderPath).toBeNull();
    expect(com.ItemType).toBe(ItemTypes.Login);

    const example = byName(imported, 'Example');
    expect(example.ServiceUrls?.[0]).toBe('https://www.example.com');
    expect(example.Username).toBe('exampleusername');
    expect(example.Password).toBe('examplepassword');
    expect(example.Notes).toBe('Examplenote');
    expect(example.FolderPath).toBeNull();
    expect(example.ItemType).toBe(ItemTypes.Login);

    const safeNote = byName(imported, 'Safenotename');
    expect(safeNote.ServiceUrls?.[0]).toBeUndefined();
    expect(safeNote.Username ?? '').toBe('');
    expect(safeNote.Password ?? '').toBe('');
    expect(safeNote.Notes).toBe('Safenote content example here');
    expect(safeNote.ItemType).toBe(ItemTypes.Note);

    const business = byName(imported, 'Business');
    expect(business.ServiceUrls?.[0]).toBe('https://www.business.com');
    expect(business.Username).toBe('businessusername');
    expect(business.Password).toBe('businesspassword');
    expect(business.FolderPath).toBe('Business');
    expect(business.ItemType).toBe(ItemTypes.Login);

    const multiline = byName(imported, 'Multiline safenote');
    expect(multiline.Notes?.startsWith('First note line')).toBe(true);
    expect(multiline.Notes).toContain('Fourth note line after a blank one');
    expect(multiline.ItemType).toBe(ItemTypes.Note);
  });

  it('imports RoboForm folders', () => {
    const imported = importRoboformCsv(readFixtureText(import.meta.dirname, 'roboform.csv'));
    expect(collectHierarchicalFolderPaths(imported)).toContain('Business');
    expect(imported.find(c => c.FolderPath === 'Business')!.ServiceName).toBe('Business');
  });

  it('detects RoboForm secure notes', () => {
    const items = convertToItems(importRoboformCsv(readFixtureText(import.meta.dirname, 'roboform.csv')));
    const secureNote = itemByName(items, 'Safenotename');
    expect(secureNote.ItemType).toBe(ItemTypes.Note);
    expect(secureNote.FieldValues.find(fv => fv.FieldKey === FieldKey.NotesContent)?.Value).toBe('Safenote content example here');
  });
});
