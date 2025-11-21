import { UsernameEmailGenerator } from '../../utils/UsernameEmailGenerator';
import { Gender } from '../../types/Gender';
import { IIdentityGenerator, IBirthdateOptions } from '../../interfaces/IIdentityGenerator';
import { Identity } from '../../types/Identity';

/**
 * Dictionary of firstnames organized by decade range.
 */
export interface IDecadeFirstnames {
  startYear: number;
  endYear: number;
  names: string[];
}

/**
 * Base identity generator.
 */
export abstract class IdentityGenerator implements IIdentityGenerator {
  protected firstNamesMale: string[] = [];
  protected firstNamesFemale: string[] = [];
  protected lastNames: string[] = [];
  private readonly random = Math.random;

  /**
   * Constructor.
   */
  public constructor() {
    // Each implementing class should provide these as static JSON strings
    this.firstNamesMale = this.getFirstNamesMaleJson();
    this.firstNamesFemale = this.getFirstNamesFemaleJson();
    this.lastNames = this.getLastNamesJson();
  }

  protected abstract getFirstNamesMaleJson(): string[];
  protected abstract getFirstNamesFemaleJson(): string[];
  protected abstract getLastNamesJson(): string[];

  /**
   * Get decade-based male first names. Override this to provide age-specific names.
   * If not overridden, returns an empty array and falls back to generic names.
   */
  protected getFirstNamesMaleByDecade(): IDecadeFirstnames[] {
    return [];
  }

  /**
   * Get decade-based female first names. Override this to provide age-specific names.
   * If not overridden, returns an empty array and falls back to generic names.
   */
  protected getFirstNamesFemaleByDecade(): IDecadeFirstnames[] {
    return [];
  }

  /**
   * Generate a random date of birth.
   * @param birthdateOptions Optional birthdate configuration
   */
  protected generateRandomDateOfBirth(birthdateOptions?: IBirthdateOptions): Date {
    if (birthdateOptions) {
      const { targetYear, yearDeviation } = birthdateOptions;

      if (yearDeviation === 0) {
        // Generate a random date within the target year
        const startOfYear = new Date(targetYear, 0, 1);
        const endOfYear = new Date(targetYear, 11, 31);
        const timestamp = startOfYear.getTime() + (this.random() * (endOfYear.getTime() - startOfYear.getTime()));
        return new Date(timestamp);
      } else {
        // Generate a random date within the year range
        const minYear = targetYear - yearDeviation;
        const maxYear = targetYear + yearDeviation;
        const startDate = new Date(minYear, 0, 1);
        const endDate = new Date(maxYear, 11, 31);
        const timestamp = startDate.getTime() + (this.random() * (endDate.getTime() - startDate.getTime()));
        return new Date(timestamp);
      }
    }

    // Default behavior: generate birthdate for age between 21 and 65
    const today = new Date();
    const minAge = 21;
    const maxAge = 65;

    const minDate = new Date(today.getFullYear() - maxAge, today.getMonth(), today.getDate());
    const maxDate = new Date(today.getFullYear() - minAge, today.getMonth(), today.getDate());

    const timestamp = minDate.getTime() + (this.random() * (maxDate.getTime() - minDate.getTime()));
    return new Date(timestamp);
  }

  /**
   * Select appropriate firstnames based on birthdate.
   * Falls back to generic names if no decade-specific data is available.
   */
  protected selectFirstnamesForBirthdate(birthdate: Date, isMale: boolean): string[] {
    const birthYear = birthdate.getFullYear();
    const decadeData = isMale ? this.getFirstNamesMaleByDecade() : this.getFirstNamesFemaleByDecade();

    if (decadeData.length === 0) {
      // No decade-specific data, use generic lists
      return isMale ? this.firstNamesMale : this.firstNamesFemale;
    }

    // Find matching decade ranges
    const matchingRanges = decadeData.filter(
      range => birthYear >= range.startYear && birthYear <= range.endYear
    );

    if (matchingRanges.length > 0) {
      // Combine all matching ranges
      const combinedNames: string[] = [];
      matchingRanges.forEach(range => combinedNames.push(...range.names));
      return combinedNames;
    }

    // No matching range found, combine all available decade names
    const allDecadeNames: string[] = [];
    decadeData.forEach(range => allDecadeNames.push(...range.names));

    // If we have decade data but birthdate doesn't match, use all decade data
    if (allDecadeNames.length > 0) {
      return allDecadeNames;
    }

    // Fallback to generic lists
    return isMale ? this.firstNamesMale : this.firstNamesFemale;
  }

  /**
   * Generate a random identity.
   */
  public generateRandomIdentity(gender?: string | 'random', birthdateOptions?: IBirthdateOptions): Identity {
    const identity: Identity = {
      firstName: '',
      lastName: '',
      gender: Gender.Male,
      birthDate: new Date(),
      emailPrefix: '',
      nickName: ''
    };

    // Determine gender
    let selectedGender: Gender;
    if (gender === 'random' || gender === undefined) {
      // Random selection (default behavior)
      selectedGender = this.random() < 0.5 ? Gender.Male : Gender.Female;
    } else {
      // Use specified gender
      if (gender === 'male') {
        selectedGender = Gender.Male;
      } else if (gender === 'female') {
        selectedGender = Gender.Female;
      } else {
        selectedGender = Gender.Male;
      }
    }

    // Set gender
    identity.gender = selectedGender;

    // Generate birthdate first (needed for age-based firstname selection)
    identity.birthDate = this.generateRandomDateOfBirth(birthdateOptions);

    // Select appropriate first name based on gender and birthdate
    let availableFirstnames: string[];
    if (selectedGender === Gender.Male) {
      availableFirstnames = this.selectFirstnamesForBirthdate(identity.birthDate, true);
    } else if (selectedGender === Gender.Female) {
      availableFirstnames = this.selectFirstnamesForBirthdate(identity.birthDate, false);
    } else {
      // For Gender.Other, randomly choose from either list
      const usesMaleNames = this.random() < 0.5;
      availableFirstnames = this.selectFirstnamesForBirthdate(identity.birthDate, usesMaleNames);
    }

    identity.firstName = availableFirstnames[Math.floor(this.random() * availableFirstnames.length)];
    identity.lastName = this.lastNames[Math.floor(this.random() * this.lastNames.length)];

    const generator = new UsernameEmailGenerator();
    identity.emailPrefix = generator.generateEmailPrefix(identity);
    identity.nickName = generator.generateUsername(identity);

    return identity;
  }
}