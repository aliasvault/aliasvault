import { IdentityGenerator } from "./base/IdentityGenerator";
import maleNames from '../dictionaries/es/firstnames_male';
import femaleNames from '../dictionaries/es/firstnames_female';
import lastNames from '../dictionaries/es/lastnames';

/**
 * Identity generator for Spanish language using Spanish word dictionaries.
 */
export class IdentityGeneratorEs extends IdentityGenerator {
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
