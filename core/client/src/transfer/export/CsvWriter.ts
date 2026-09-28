/**
 * Quote a field when needed: it contains a quote, the delimiter or a line break, or starts or ends with
 * a space.
 * @param value - The field value
 * @returns The field as it appears in the file
 */
export function escapeCsvField(value: string): string {
  const needsQuotes = value.includes('"') || value.includes(',') || value.includes('\r') || value.includes('\n') || value.startsWith(' ') || value.endsWith(' ');
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Write rows as CSV text with CRLF line endings.
 * @param headers - The header row
 * @param rows - The data rows, each in header order
 * @returns The CSV text
 */
export function writeCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map(row => row.map(escapeCsvField).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
