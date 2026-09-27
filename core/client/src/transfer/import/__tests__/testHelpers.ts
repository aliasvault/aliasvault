import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { ItemEntity } from '../../shared/VaultEntities';
import type { ImportedCredential } from '../models/ImportedCredential';

/*
 * Fixture readers and lookups for the import tests; fixtures live next to the test that reads them.
 */

/**
 * Read a fixture as text.
 * @param dir - The directory holding the fixture, usually the test's own `import.meta.dirname`
 * @param name - The file name
 * @returns The file content
 */
export function readFixtureText(dir: string, name: string): string {
  return readFileSync(path.join(dir, name), 'utf8');
}

/**
 * Read a fixture as bytes.
 * @param dir - The directory holding the fixture, usually the test's own `import.meta.dirname`
 * @param name - The file name
 * @returns The file bytes
 */
export function readFixtureBytes(dir: string, name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(dir, name)));
}

/**
 * The first credential with a given service name.
 * @param credentials - The credentials
 * @param serviceName - The service name
 * @returns The credential
 */
export function byName(credentials: ImportedCredential[], serviceName: string): ImportedCredential {
  const credential = credentials.find(c => c.ServiceName === serviceName);
  if (!credential) {
    throw new Error(`No credential named '${serviceName}'`);
  }
  return credential;
}

/**
 * The first item with a given name.
 * @param items - The items
 * @param name - The item name
 * @returns The item
 */
export function itemByName(items: ItemEntity[], name: string): ItemEntity {
  const item = items.find(i => i.Name === name);
  if (!item) {
    throw new Error(`No item named '${name}'`);
  }
  return item;
}

/**
 * A UTC date.
 * @param year - Year
 * @param month - 1-based month
 * @param day - Day
 * @returns The date
 */
export function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}
