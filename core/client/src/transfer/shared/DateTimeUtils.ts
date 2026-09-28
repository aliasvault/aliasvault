/*
 * Date parsing for the import formats. Every date is UTC: a value without a timezone designator (an .avux manifest,
 * a CSV column) is read as UTC, never as local time.
 */

/**
 * Parse a date/time in any of the formats the import files carry: ISO 8601 (with or without timezone), the
 * vault's "yyyy-MM-dd HH:mm:ss(.fff)", the US style "MM/dd/yyyy HH:mm:ss" and a bare "yyyy-MM-dd".
 * @param value - The text
 * @returns The date, or null when empty or unparseable
 */
export function parseDateTime(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const text = value.trim();
  if (text.length === 0) {
    return null;
  }

  // ISO 8601 and the vault format: yyyy-MM-dd[( |T)HH:mm[:ss[.fff]]][Z|+hh:mm]
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,7}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(text);
  if (iso) {
    const [, year, month, day, hour, minute, second, fraction, zone] = iso;
    const millis = fraction ? Number(fraction.substring(0, 3).padEnd(3, '0')) : 0;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour ?? 0), Number(minute ?? 0), Number(second ?? 0), millis));
    if (zone && zone !== 'Z') {
      const sign = zone.startsWith('-') ? -1 : 1;
      const digits = zone.substring(1).replace(':', '');
      const offsetMinutes = sign * (Number(digits.substring(0, 2)) * 60 + Number(digits.substring(2, 4)));
      date.setTime(date.getTime() - offsetMinutes * 60000);
    }
    return isNaN(date.getTime()) ? null : date;
  }

  // US style: MM/dd/yyyy[ HH:mm:ss], also with dashes.
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (us) {
    const [, month, day, year, hour, minute, second] = us;
    return utcDate(Number(year), Number(month), Number(day), Number(hour ?? 0), Number(minute ?? 0), Number(second ?? 0));
  }

  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Parse a date in one explicit day/month order, for sources whose birth dates are written the European way.
 * @param value - The text
 * @param format - "dd-MM-yyyy", "MM-dd-yyyy", "dd/MM/yyyy" or "MM/dd/yyyy"
 * @returns The date, or null when the text does not match
 */
export function parseDateExact(value: string, format: 'dd-MM-yyyy' | 'MM-dd-yyyy' | 'dd/MM/yyyy' | 'MM/dd/yyyy'): Date | null {
  const separator = format.includes('/') ? '/' : '-';
  const parts = value.trim().split(separator);
  if (parts.length !== 3 || parts.some(part => !/^\d+$/.test(part))) {
    return null;
  }
  const [first, second, third] = parts.map(Number);
  const dayFirst = format.startsWith('dd');
  return utcDate(third, dayFirst ? second : first, dayFirst ? first : second, 0, 0, 0);
}

/**
 * Build a UTC date, rejecting values that do not denote a real calendar date.
 * @param year - Four-digit year
 * @param month - 1-based month
 * @param day - Day of month
 * @param hour - Hour
 * @param minute - Minute
 * @param second - Second
 * @returns The date, or null when out of range
 */
function utcDate(year: number, month: number, day: number, hour: number, minute: number, second: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && hour < 24 && minute < 60 && second < 60;
  return valid ? date : null;
}

/**
 * Convert a Unix timestamp in seconds to a date, or null when it falls outside years 1 to 9999 (e.g. a value in milliseconds).
 * @param seconds - Seconds since the epoch
 * @returns The date, or null
 */
export function fromUnixTimeSeconds(seconds: number | null | undefined): Date | null {
  if (typeof seconds !== 'number') {
    return null;
  }
  const date = new Date(Math.trunc(seconds) * 1000);
  const year = date.getUTCFullYear();
  return year >= 1 && year <= 9999 ? date : null;
}

/**
 * Format a date as "yyyy-MM-dd" (UTC).
 * @param date - The date
 * @returns The formatted date
 */
export function formatDateOnly(date: Date): string {
  return date.toISOString().substring(0, 10);
}
