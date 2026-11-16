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

/** Translates a key, with a count for the plural keys. */
type Translate = (key: string, options?: { count: number }) => string;

/** Plural translation keys for the relative formats, largest unit first, with the unit length in seconds. */
const RELATIVE_UNITS: [string, number][] = [['common.timeAgo.years', 31536000], ['common.timeAgo.months', 2592000], ['common.timeAgo.days', 86400], ['common.timeAgo.hours', 3600], ['common.timeAgo.minutes', 60]];

/** Age in seconds up to which a date-time reads as "yesterday", and {@link toRecentDisplayFormat} stays relative. */
const RECENT_SECONDS = 172800;

/**
 * Formats a stored date-time as a relative time, such as "just now", "yesterday" or "3 years ago".
 * @param value - The date-time string, in the standard format or ISO 8601
 * @param t - The translation function
 * @param reference - The moment to compare with, now by default
 * @returns The relative time, or the raw value when it cannot be parsed
 */
export function toRelativeDisplayFormat(value: string, t: Translate, reference: Date = new Date()): string {
  const date = parseUtc(value);
  return isNaN(date.getTime()) ? value : formatRelative(secondsAgo(date, reference), t);
}

/**
 * Formats a stored date-time as a relative time while it is under two days old, and as a short day and month after that.
 * @param value - The date-time string, in the standard format or ISO 8601
 * @param t - The translation function
 * @param reference - The moment to compare with, now by default
 * @returns The relative time or date, or the raw value when it cannot be parsed
 */
export function toRecentDisplayFormat(value: string, t: Translate, reference: Date = new Date()): string {
  const date = parseUtc(value);
  if (isNaN(date.getTime())) {
    return value;
  }
  const seconds = secondsAgo(date, reference);
  return seconds < RECENT_SECONDS ? formatRelative(seconds, t) : date.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
}

/**
 * The seconds between a date and the reference moment; a date after the reference (clock skew) counts as zero.
 * @param date - The date
 * @param reference - The moment to compare with
 * @returns The age in seconds, never negative
 */
function secondsAgo(date: Date, reference: Date): number {
  return Math.max(0, (reference.getTime() - date.getTime()) / 1000);
}

/**
 * Formats an age in seconds in the largest whole unit; under a minute reads as "just now".
 * @param seconds - The age in seconds
 * @param t - The translation function
 * @returns The relative time
 */
function formatRelative(seconds: number, t: Translate): string {
  if (seconds >= 86400 && seconds < RECENT_SECONDS) {
    return t('common.timeAgo.yesterday');
  }
  const match = RELATIVE_UNITS.find(([, length]) => seconds >= length);
  return match ? t(match[0], { count: Math.floor(seconds / match[1]) }) : t('common.timeAgo.justNow');
}

/**
 * Parses a date-time string, reading one without a timezone designator as UTC.
 * @param value - The date-time string
 * @returns The date, invalid when the value cannot be read
 */
function parseUtc(value: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2}[T ][\d:.]+$/.test(value) ? `${value.replace(' ', 'T')}Z` : value);
}
