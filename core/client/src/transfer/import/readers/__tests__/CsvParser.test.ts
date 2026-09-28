import { describe, expect, it } from 'vitest';

import { parseCsvRows } from '../CsvParser';

describe('parseCsvRows', () => {
  it('parses quoted fields with escaped quotes, delimiters and line breaks', () => {
    const rows = parseCsvRows('﻿name,notes\r\nA,"say ""hi"", then\nbye"\n\nB,plain\n');
    expect(rows).toEqual([['name', 'notes'], ['A', 'say "hi", then\nbye'], ['B', 'plain']]);
  });

  it('throws when a quoted field is never closed', () => {
    expect(() => parseCsvRows('name,password\nA,"secret\nB,pw2\nC,pw3\n')).toThrow(/row 2 is never closed/);
  });

  it('detects a semicolon delimiter', () => {
    const rows = parseCsvRows('name;url;notes\nA;https://a.example;one, two\nB;https://b.example;"x;y"\n');
    expect(rows).toEqual([['name', 'url', 'notes'], ['A', 'https://a.example', 'one, two'], ['B', 'https://b.example', 'x;y']]);
  });

  it('keeps the comma when semicolons only appear inside fields', () => {
    const rows = parseCsvRows('name,url,notes\nA,https://a.example,one; two\nB,https://b.example,three; four; five\n');
    expect(rows).toEqual([['name', 'url', 'notes'], ['A', 'https://a.example', 'one; two'], ['B', 'https://b.example', 'three; four; five']]);
  });

  it('prefers the comma when both delimiters split consistently', () => {
    expect(parseCsvRows('a;b,c;d\ne;f,g;h\n')).toEqual([['a;b', 'c;d'], ['e;f', 'g;h']]);
  });

  it('falls back to the comma for a single column', () => {
    expect(parseCsvRows('name\nA\n')).toEqual([['name'], ['A']]);
  });
});
