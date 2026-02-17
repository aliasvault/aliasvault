import { IdentityGenerator } from "./base/IdentityGenerator";
import maleNames from '../dictionaries/fa/firstnames_male';
import femaleNames from '../dictionaries/fa/firstnames_female';
import lastNames from '../dictionaries/fa/lastnames';

/**
 * Identity generator for Persian (Farsi) language using Persian word dictionaries.
 */
export class IdentityGeneratorFa extends IdentityGenerator {
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
