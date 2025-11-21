import type { IBirthdateOptions } from '../interfaces/IIdentityGenerator';

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
