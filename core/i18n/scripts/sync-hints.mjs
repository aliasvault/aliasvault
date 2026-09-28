#!/usr/bin/env node
/*
 * Copies the translator hints of core/i18n/hints.json into the context field of the matching Crowdin strings.
 * Only strings whose context differs are updated, so running it again is cheap.
 *
 * Environment: CROWDIN_PROJECT_ID, CROWDIN_PERSONAL_TOKEN. Pass --dry-run to only print the changes.
 *   node core/i18n/scripts/sync-hints.mjs [--dry-run]
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_FILE = '/core/i18n/locales/en.json';
const API = 'https://api.crowdin.com/api/v2';
const projectId = process.env.CROWDIN_PROJECT_ID;
const token = process.env.CROWDIN_PERSONAL_TOKEN;
const dryRun = process.argv.includes('--dry-run');

if (!projectId || !token) {
  console.error('CROWDIN_PROJECT_ID and CROWDIN_PERSONAL_TOKEN must be set.');
  process.exit(1);
}

const hints = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../hints.json'), 'utf8'));

/**
 * Call the Crowdin API.
 * @param {string} method
 * @param {string} url
 * @param {unknown} [body]
 */
async function crowdin(method, url, body) {
  const response = await fetch(`${API}${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${method} ${url} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

/**
 * Fetch every page of a Crowdin list endpoint.
 * @param {string} url
 */
async function listAll(url) {
  const items = [];
  for (let offset = 0; ; offset += 500) {
    const page = await crowdin('GET', `${url}${url.includes('?') ? '&' : '?'}limit=500&offset=${offset}`);
    items.push(...page.data.map((entry) => entry.data));
    if (page.data.length < 500) return items;
  }
}

/* The GitHub integration puts synced files under a Crowdin branch folder, e.g. /main/core/i18n/locales/en.json. */
const files = await listAll(`/projects/${projectId}/files`);
const candidates = files.filter((f) => f.path === SOURCE_FILE || f.path.endsWith(SOURCE_FILE));
if (candidates.length !== 1) {
  const enFiles = files.filter((f) => f.path.endsWith('/en.json')).map((f) => f.path);
  throw new Error(`Expected one Crowdin source file matching ${SOURCE_FILE}, found ${candidates.length}. en.json files in the project: ${enFiles.join(', ') || 'none'}`);
}
const file = candidates[0];

/* Crowdin shows nested JSON keys as "a.b" or "a -> b" depending on the parser; accept both. */
const keyOf = (identifier) => identifier.replace(/\s*->\s*/g, '.');
let updated = 0;
let unchanged = 0;
const found = new Set();
for (const string of await listAll(`/projects/${projectId}/strings?fileId=${file.id}`)) {
  const key = keyOf(string.identifier);
  const hint = hints[key];
  if (hint === undefined) continue;
  found.add(key);
  if ((string.context ?? '').trim() === hint) {
    unchanged++;
    continue;
  }
  console.info(`${key}: ${hint}`);
  if (!dryRun) {
    await crowdin('PATCH', `/projects/${projectId}/strings/${string.id}`, [{ op: 'replace', path: '/context', value: hint }]);
  }
  updated++;
}

const missing = Object.keys(hints).filter((key) => !found.has(key));
console.info(`${dryRun ? 'Would update' : 'Updated'} ${updated}, unchanged ${unchanged}, hints without a Crowdin string ${missing.length}.`);
if (missing.length > 0) {
  console.info(`Not found in Crowdin (not uploaded yet, or a stale hint): ${missing.join(', ')}`);
}
