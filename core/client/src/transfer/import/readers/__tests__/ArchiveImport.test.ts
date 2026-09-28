import { describe, expect, it } from 'vitest';

import { createZipArchive, textToZipBytes } from '../../../shared/ZipArchive';
import { importBitwardenZip } from '../../importers/bitwarden/BitwardenZipImporter';
import { ImportException, ImportStage } from '../../models/ImportException';
import { buildItemFailure } from '../ArchiveImport';
import { JsonException } from '../JsonReader';

import type { ImportFileResult } from '../../models/ImportFileResult';

describe('ArchiveImport', () => {
  it('reports a corrupt archive as an Archive stage failure', () => {
    const corruptBytes = new TextEncoder().encode('definitely not a zip');

    let caught: unknown;
    try {
      importBitwardenZip(corruptBytes);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ImportException);
    expect((caught as ImportException).stage).toBe(ImportStage.Archive);
    expect((caught as ImportException).message).toContain('not a valid ZIP archive');
  });

  it('reports a missing manifest as a Parse stage failure', () => {
    const zipBytes = createZipArchive({});

    let caught: unknown;
    try {
      importBitwardenZip(zipBytes);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ImportException);
    expect((caught as ImportException).stage).toBe(ImportStage.Parse);
    expect((caught as ImportException).message).toContain('data.json');
    expect((caught as ImportException).message).toContain('not found');
  });

  it('reports malformed JSON with the parse error', () => {
    const zipBytes = createZipArchive({ 'data.json': textToZipBytes('{"encrypted":false,"folders":[],"items":[{') });

    let caught: unknown;
    try {
      importBitwardenZip(zipBytes);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ImportException);
    expect((caught as ImportException).stage).toBe(ImportStage.Parse);
    expect((caught as ImportException).message).toContain('data.json');
    expect((caught as ImportException).message).toContain('Failed to parse');
    expect((caught as ImportException).innerError).toBeInstanceOf(JsonException);
  });

  it('collects a malformed item as a per-item failure', () => {
    const zipBytes = createZipArchive({ 'data.json': textToZipBytes('{"encrypted":false,"folders":[],"items":[{"name":"Broken","type":"not-a-number"},{"type":1,"name":"Fine","login":{"username":"u","password":"p"}}]}') });

    const result: ImportFileResult = importBitwardenZip(zipBytes);

    expect(result.Credentials).toHaveLength(1);
    expect(result.Credentials[0].ServiceName).toBe('Fine');
    expect(result.FailedItems).toHaveLength(1);
    expect(result.FailedItems[0].Index).toBe(0);
    expect(result.FailedItems[0].ItemTitle).toBe('Broken');
    expect(result.FailedItems[0].ExceptionType).toBe('JsonException');
  });

  it('builds per-item failures the same way for every archive importer', () => {
    const failure = buildItemFailure(3, 'Title', new JsonException('bad'));
    expect(failure.ExceptionType).toBe('JsonException');
    expect(failure.Message).toContain('bad');
  });
});
