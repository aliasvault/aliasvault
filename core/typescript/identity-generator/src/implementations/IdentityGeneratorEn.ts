import { IdentityGenerator } from "./base/IdentityGenerator";
import maleNames from '../dictionaries/en/firstnames_male';
import femaleNames from '../dictionaries/en/firstnames_female';
import lastNames from '../dictionaries/en/lastnames';

/**
 * Identity generator for English language using English word dictionaries.
 */
export class IdentityGeneratorEn extends IdentityGenerator {
  /**
   * Get the male first names.
   */
  protected getFirstNamesMaleJson(): string[] {
    return maleNames;
  }

  /**
   * Get the female first names.
   */
  protected getFirstNamesFemaleJson(): string[] {
    return femaleNames;
  }

  /**
   * Get the last names.
   */
  protected getLastNamesJson(): string[] {
    return lastNames;
  }
}
