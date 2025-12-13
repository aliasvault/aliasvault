import type { IBirthdateOptions } from '../interfaces/IIdentityGenerator';

/**
 * Represents an age range option for identity generation.
 */
export interface IAgeRangeOption {
  /**
   * The value to store (e.g., "21-25", "random")
   */
  value: string;

  /**
   * The display label (e.g., "21-25", "Random")
   */
  label: string;
}

/**
 * Gets all available age range options for identity generation.
 * @returns Array of age range options
 */
export function getAvailableAgeRanges(): IAgeRangeOption[] {
  return [
    { value: 'random', label: 'Random' },
    { value: '21-25', label: '21-25' },
    { value: '26-30', label: '26-30' },
    { value: '31-35', label: '31-35' },
    { value: '36-40', label: '36-40' },
    { value: '41-45', label: '41-45' },
    { value: '46-50', label: '46-50' },
    { value: '51-55', label: '51-55' },
    { value: '56-60', label: '56-60' },
    { value: '61-65', label: '61-65' }
  ];
}

/**
 * Converts an age range string (e.g., "21-25", "30-35", or "random") to birthdate options.
 * @param ageRange - The age range string
 * @returns An object containing targetYear and yearDeviation, or null if random
 */
export function convertAgeRangeToBirthdateOptions(ageRange: string): IBirthdateOptions | null {
  if (ageRange === 'random' || !ageRange) {
    return null; // Use default behavior
  }

  // Parse age range like "21-25" or "30-35"
  const parts = ageRange.split('-');
  if (parts.length !== 2) {
    return null;
  }

  const minAge = parseInt(parts[0], 10);
  const maxAge = parseInt(parts[1], 10);

  if (isNaN(minAge) || isNaN(maxAge)) {
    return null;
  }

  const currentYear = new Date().getFullYear();

  // Calculate the middle of the age range
  const middleAge = Math.floor((minAge + maxAge) / 2);

  // Calculate target year (birth year for middle age)
  const targetYear = currentYear - middleAge;

  // Calculate deviation (half the range size)
  const yearDeviation = Math.floor((maxAge - minAge) / 2);

  return { targetYear, yearDeviation };
}
