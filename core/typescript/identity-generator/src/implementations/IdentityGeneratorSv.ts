import { IdentityGenerator } from "./base/IdentityGenerator";
import maleNames from '../dictionaries/sv/firstnames_male';
import femaleNames from '../dictionaries/sv/firstnames_female';
import lastNames from '../dictionaries/sv/lastnames';

/**
 * Identity generator for Swedish language using Swedish word dictionaries.
 */
export class IdentityGeneratorSv extends IdentityGenerator {
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
