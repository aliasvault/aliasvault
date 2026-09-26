/*
 * CSV parser utility.
 */

/**
 * Split CSV text into rows of fields. Blank lines are skipped, a byte order mark is ignored.
 * @param content - The CSV text
 * @returns The rows, each an array of field values
 */
export function parseCsvRows(content: string): string[][] {
  const text = content.charCodeAt(0) === 0xFEFF ? content.substring(1) : content;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;

  while (i < text.length) {
    const c = text[i];
    if (c === '"' && field === '') {
      i++;
      while (i < text.length && !(text[i] === '"' && isFieldEnd(text, i + 1))) {
        field += text[i];
        i += text[i] === '"' && text[i + 1] === '"' ? 2 : 1;
      }
      i++;
    } else if (c === ',') {
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
  if (row.length > 0 || field !== '') {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Whether the field ends at `i`: a delimiter, a line break or the end of the text.
 * @param text - The CSV text
 * @param i - The index to check
 * @returns True when a field ends there
 */
function isFieldEnd(text: string, i: number): boolean {
  return i >= text.length || text[i] === ',' || text[i] === '\r' || text[i] === '\n';
}
