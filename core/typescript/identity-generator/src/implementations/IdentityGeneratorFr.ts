import { IdentityGenerator } from "./base/IdentityGenerator";
import maleNames from '../dictionaries/fr/firstnames_male';
import femaleNames from '../dictionaries/fr/firstnames_female';
import lastNames from '../dictionaries/fr/lastnames';

/**
 * Identity generator for French language using French word dictionaries.
 */
export class IdentityGeneratorFr extends IdentityGenerator {
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
