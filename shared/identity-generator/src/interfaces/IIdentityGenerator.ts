import { Identity } from "../types/Identity";

/**
 * Options for birthdate generation.
 */
export interface IBirthdateOptions {
  /**
   * The target year for the birthdate (e.g., 1990).
   */
  targetYear: number;

  /**
   * The random deviation in years (e.g., 5 means ±5 years from targetYear).
   * If 0, a random date within the target year will be chosen.
   */
  yearDeviation: number;
}

export interface IIdentityGenerator {
  generateRandomIdentity(gender?: string | 'random', birthdateOptions?: IBirthdateOptions): Identity;
}
