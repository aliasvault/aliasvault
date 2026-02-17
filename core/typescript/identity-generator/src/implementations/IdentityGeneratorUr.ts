import { IdentityGenerator } from "./base/IdentityGenerator";
import maleNames from '../dictionaries/ur/firstnames_male';
import femaleNames from '../dictionaries/ur/firstnames_female';
import lastNames from '../dictionaries/ur/lastnames';

/**
 * Identity generator for Urdu language using Urdu word dictionaries.
 */
export class IdentityGeneratorUr extends IdentityGenerator {
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
