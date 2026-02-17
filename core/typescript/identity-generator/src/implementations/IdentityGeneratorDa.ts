import { IdentityGenerator } from "./base/IdentityGenerator";
import maleNames from '../dictionaries/da/firstnames_male';
import femaleNames from '../dictionaries/da/firstnames_female';
import lastNames from '../dictionaries/da/lastnames';

/**
 * Identity generator for Danish language using Danish word dictionaries.
 */
export class IdentityGeneratorDa extends IdentityGenerator {
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
