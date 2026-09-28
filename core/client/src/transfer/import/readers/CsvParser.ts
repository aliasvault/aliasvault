/*
 * CSV parser utility.
 */

/**
 * The delimiters a file may use: a comma, or a semicolon as spreadsheet apps write for locales with a decimal comma.
 */
const CANDIDATE_DELIMITERS = [',', ';'] as const;

/**
 * How many rows the delimiter detection looks at.
 */
const DETECTION_ROW_COUNT = 10;

/**
 * Split CSV text into rows of fields. The delimiter (comma or semicolon) is detected, blank lines are skipped and a
 * byte order mark is ignored.
 * @param content - The CSV text
 * @returns The rows, each an array of field values
 * @throws {Error} When a quoted field is never closed, which would otherwise swallow every row after it.
 */
export function parseCsvRows(content: string): string[][] {
  const text = content.charCodeAt(0) === 0xFEFF ? content.substring(1) : content;
  const { rows, unterminatedQuote } = splitRows(text, detectDelimiter(text));
  if (unterminatedQuote) {
    throw new Error(`The CSV file is malformed: a quoted field that starts on row ${rows.length + 1} is never closed.`);
  }
  return rows;
}

/**
 * Pick the delimiter the first rows split on most consistently.
 * @param text - The CSV text
 * @returns The delimiter
 */
function detectDelimiter(text: string): string {
  let best: { delimiter: string; delta: number } | null = null;
  for (const delimiter of CANDIDATE_DELIMITERS) {
    const { rows } = splitRows(text, delimiter, DETECTION_ROW_COUNT);
    if (rows.length === 0) {
      continue;
    }

    const averageFieldCount = rows.reduce((sum, row) => sum + row.length, 0) / rows.length;
    const delta = rows.slice(1).reduce((sum, row, index) => sum + Math.abs(row.length - rows[index].length), 0);
    if (averageFieldCount >= 2 && (!best || delta < best.delta)) {
      best = { delimiter, delta };
    }
  }
  return best?.delimiter ?? ',';
}

/**
 * Split CSV text into rows of fields on the given delimiter.
 * @param text - The CSV text, without a byte order mark
 * @param delimiter - The field delimiter
 * @param maxRows - Stop after this many rows
 * @returns The rows, and whether the text ended inside a quoted field
 */
function splitRows(text: string, delimiter: string, maxRows = Infinity): { rows: string[][]; unterminatedQuote: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;

  while (i < text.length && rows.length < maxRows) {
    const c = text[i];
    if (c === '"' && field === '') {
      i++;
      while (i < text.length && !(text[i] === '"' && isFieldEnd(text, i + 1, delimiter))) {
        field += text[i];
        i += text[i] === '"' && text[i + 1] === '"' ? 2 : 1;
      }
      if (i >= text.length) {
        return { rows, unterminatedQuote: true };
      }
      i++;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
      i++;
    } else if (c === '\r' || c === '\n') {
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
      if (row.length > 0 || field !== '') {
        row.push(field);
        rows.push(row);
      }
      row = [];
      field = '';
    } else {
      field += c;
      i++;
    }
  }
  if (rows.length < maxRows && (row.length > 0 || field !== '')) {
    row.push(field);
    rows.push(row);
  }
  return { rows, unterminatedQuote: false };
}

/**
 * Whether the field ends at `i`: a delimiter, a line break or the end of the text.
 * @param text - The CSV text
 * @param i - The index to check
 * @param delimiter - The field delimiter
 * @returns True when a field ends there
 */
function isFieldEnd(text: string, i: number, delimiter: string): boolean {
  return i >= text.length || text[i] === delimiter || text[i] === '\r' || text[i] === '\n';
}
