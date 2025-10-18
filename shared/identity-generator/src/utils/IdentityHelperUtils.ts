/**
 * Helper utilities for identity generation that can be used by multiple client applications.
 */
export class IdentityHelperUtils {
  /**
   * Normalize a birth date for display.
   */
  public static normalizeBirthDateForDisplay(birthDate: string | undefined): string {
    if (!birthDate || birthDate.startsWith('0001-01-01')) {
      return '';
    }

    // Handle both space and T separators
    return birthDate.split(/[T ]/)[0]; // Strip time
  }

  /**
   * Normalize a birth date for database.
   */
  public static normalizeBirthDateForDb(input: string | undefined): string {
    if (!input || input.trim() === '') {
      return '0001-01-01 00:00:00';
    }

    const trimmed = input.trim();

    // Check if the format is valid ISO-like string manually, to support pre-1970 dates
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T ]?(\d{2}):?(\d{2}):?(\d{2})?/);
    if (match) {
      const [_, y, m, d, h = '00', mi = '00', s = '00'] = match;
      return `${y}-${m}-${d} ${h}:${mi}:${s}`;
    }

    // Fall back to native Date parsing only if ISO conversion not needed
    const parsedDate = new Date(trimmed);
    if (!isNaN(parsedDate.getTime())) {
      const year = parsedDate.getFullYear().toString().padStart(4, '0');
      const month = (parsedDate.getMonth() + 1).toString().padStart(2, '0');
      const day = parsedDate.getDate().toString().padStart(2, '0');
      return `${year}-${month}-${day} 00:00:00`;
    }

    return '0001-01-01 00:00:00';
  }

  /**
   * Check if a birth date is valid.
   */
  public static isValidBirthDate(input: string | undefined): boolean {
    if (!input || input.trim() === '') {
      return false;
    }

    if (input.startsWith('0001-01-01')) {
      return false;
    }

    const date = new Date(input);

    // Check if the date is valid
    if (isNaN(date.getTime())) {
      return false;
    }

    // Check if the year is valid
    const yearValid = date.getFullYear() > 1 && date.getFullYear() < 9999;
    return yearValid;
  }
}
