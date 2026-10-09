/**
 * Centralized utility for formatting Date values consistently across the client application.
 * All dates are stored in UTC with the format: "yyyy-MM-dd HH:mm:ss.fff" (23 characters).
 * This format ensures:
 * - SQLite native support for date functions
 * - No timezone ambiguity (all dates are UTC)
 * - Consistent precision with milliseconds for accurate sorting/comparison
 * - Readable space separator instead of 'T'
 * - Lexicographic sorting works correctly
 */

/**
 * Formats a Date to the standard format string: "yyyy-MM-dd HH:mm:ss.fff" (23 characters).
 * @param date - The Date to format
 * @returns Formatted date-time string in format "yyyy-MM-dd HH:mm:ss.fff"
 */
export function toStandardFormat(date: Date): string {
  return date.toISOString()
    .replace('T', ' ')
    .replace('Z', '')
    .substring(0, 23);
}

/**
 * Formats the current UTC time to the standard format string.
 * @returns Formatted current UTC date-time string
 */
export function now(): string {
  return toStandardFormat(new Date());
}

/**
 * Parses a stored date-time string as UTC; a value without a timezone designator is read as UTC, not local time.
 * @param value - The date-time string, in the standard format or ISO 8601
 * @returns The date, or the epoch when the value cannot be read
 */
export function fromStandardFormat(value: string | null | undefined): Date {
  const date = parseUtc(value ?? '');
  return isNaN(date.getTime()) ? new Date(0) : date;
}

/**
 * Formats a date-time returned by the API (UTC by default) for display in the user's own locale and timezone.
 * @param value - The date-time string as returned by the API
 * @returns The date-time formatted for the current locale, or the raw value when it cannot be parsed
 */
export function toLocalDisplayFormat(value: string): string {
  const date = parseUtc(value);
  return isNaN(date.getTime()) ? value : date.toLocaleString();
}

/**
 * Parses a date-time string, reading one without a timezone designator as UTC.
 * @param value - The date-time string
 * @returns The date, invalid when the value cannot be read
 */
function parseUtc(value: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2}[T ][\d:.]+$/.test(value) ? `${value.replace(' ', 'T')}Z` : value);
}
