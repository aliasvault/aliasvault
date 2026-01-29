import { IdentityGenerator, IDecadeFirstnames } from "./base/IdentityGenerator";
import lastNames from '../dictionaries/de/lastnames';

// Male firstnames by decade
import maleNames1950s from '../dictionaries/de/firstnames_male_1950_1959';
import maleNames1960s from '../dictionaries/de/firstnames_male_1960_1969';
import maleNames1970s from '../dictionaries/de/firstnames_male_1970_1979';
import maleNames1980s from '../dictionaries/de/firstnames_male_1980_1989';
import maleNames1990s from '../dictionaries/de/firstnames_male_1990_1999';
import maleNames2000s from '../dictionaries/de/firstnames_male_2000_2009';
import maleNames2010s from '../dictionaries/de/firstnames_male_2010_2019';
import maleNames2020s from '../dictionaries/de/firstnames_male_2020_2029';

// Female firstnames by decade
import femaleNames1950s from '../dictionaries/de/firstnames_female_1950_1959';
import femaleNames1960s from '../dictionaries/de/firstnames_female_1960_1969';
import femaleNames1970s from '../dictionaries/de/firstnames_female_1970_1979';
import femaleNames1980s from '../dictionaries/de/firstnames_female_1980_1989';
import femaleNames1990s from '../dictionaries/de/firstnames_female_1990_1999';
import femaleNames2000s from '../dictionaries/de/firstnames_female_2000_2009';
import femaleNames2010s from '../dictionaries/de/firstnames_female_2010_2019';
import femaleNames2020s from '../dictionaries/de/firstnames_female_2020_2029';

/**
 * Identity generator for German language using German dictionaries with decade-based firstname support.
 * This implementation demonstrates how to use age-appropriate names based on birthdate.
 */
export class IdentityGeneratorDe extends IdentityGenerator {
  /**
   * Get the male first names (generic fallback - empty as we use decade-based).
   */
  protected getFirstNamesMaleJson(): string[] {
    // Return empty array as we're using decade-based approach for German
    return [];
  }

  /**
   * Get the female first names (generic fallback - empty as we use decade-based).
   */
  protected getFirstNamesFemaleJson(): string[] {
    // Return empty array as we're using decade-based approach for German
    return [];
  }

  /**
   * Get the last names.
   */
  protected getLastNamesJson(): string[] {
    return lastNames;
  }

  /**
   * Get decade-based male first names.
   * Each range covers a specific decade with names popular during that period.
   */
  protected getFirstNamesMaleByDecade(): IDecadeFirstnames[] {
    return [
      { startYear: 1950, endYear: 1959, names: maleNames1950s },
      { startYear: 1960, endYear: 1969, names: maleNames1960s },
      { startYear: 1970, endYear: 1979, names: maleNames1970s },
      { startYear: 1980, endYear: 1989, names: maleNames1980s },
      { startYear: 1990, endYear: 1999, names: maleNames1990s },
      { startYear: 2000, endYear: 2009, names: maleNames2000s },
      { startYear: 2010, endYear: 2019, names: maleNames2010s },
      { startYear: 2020, endYear: 2029, names: maleNames2020s }
    ];
  }

  /**
   * Get decade-based female first names.
   * Each range covers a specific decade with names popular during that period.
   */
  protected getFirstNamesFemaleByDecade(): IDecadeFirstnames[] {
    return [
      { startYear: 1950, endYear: 1959, names: femaleNames1950s },
      { startYear: 1960, endYear: 1969, names: femaleNames1960s },
      { startYear: 1970, endYear: 1979, names: femaleNames1970s },
      { startYear: 1980, endYear: 1989, names: femaleNames1980s },
      { startYear: 1990, endYear: 1999, names: femaleNames1990s },
      { startYear: 2000, endYear: 2009, names: femaleNames2000s },
      { startYear: 2010, endYear: 2019, names: femaleNames2010s },
      { startYear: 2020, endYear: 2029, names: femaleNames2020s }
    ];
  }
}
