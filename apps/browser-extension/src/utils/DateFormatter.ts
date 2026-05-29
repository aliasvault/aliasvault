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
 * Formats a Date to the birth date format (no milliseconds, time set to 00:00:00).
 * Format: "yyyy-MM-dd 00:00:00" (19 characters).
 * @param date - The Date to format
 * @returns Formatted date string in format "yyyy-MM-dd 00:00:00"
 */
export function toBirthDateFormat(date: Date): string {
  const isoString = date.toISOString();
  const datePart = isoString.substring(0, 10); // yyyy-MM-dd
  return `${datePart} 00:00:00`;
}
