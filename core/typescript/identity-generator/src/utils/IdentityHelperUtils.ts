/**
 * Helper utilities for identity generation that can be used by multiple client applications.
 */
export class IdentityHelperUtils {
  /**
   * Normalize a birth date to the standard format: "yyyy-MM-dd".
   * Handles various input formats including ISO strings with time components.
   * Returns empty string for invalid/empty dates.
   */
  public static normalizeBirthDate(input: string | undefined): string {
    if (!input || input.trim() === '' || input.startsWith('0001-01-01')) {
      return '';
    }

    const trimmed = input.trim();

    /*
     * Check if the format is valid ISO-like string manually, to support pre-1970 dates
     * Matches: yyyy-MM-dd, yyyy-MM-ddTHH:mm:ss, yyyy-MM-dd HH:mm:ss, yyyy-MM-dd HH:mm:ss.SSS, etc.
     */
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [, y, m, d] = match;
      return `${y}-${m}-${d}`;
    }

    // Fall back to native Date parsing only if regex match fails
    const parsedDate = new Date(trimmed);
    if (!isNaN(parsedDate.getTime())) {
      const year = parsedDate.getFullYear().toString().padStart(4, '0');
      const month = (parsedDate.getMonth() + 1).toString().padStart(2, '0');
      const day = parsedDate.getDate().toString().padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    return '';
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
