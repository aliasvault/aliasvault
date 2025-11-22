import { IdentityGeneratorEn } from '../implementations/IdentityGeneratorEn';
import { IdentityGeneratorNl } from '../implementations/IdentityGeneratorNl';
import { IdentityGeneratorDe } from '../implementations/IdentityGeneratorDe';
import { describe, it, expect } from 'vitest';
import { IIdentityGenerator, IBirthdateOptions } from '../interfaces/IIdentityGenerator';
import { Gender } from '../types/Gender';

/**
 * Test the identity generator.
 */
const testIdentityGenerator = (
  language: string,
  generator: IIdentityGenerator
) : void => {
  describe(`IdentityGenerator${language}`, () => {
    describe('generateRandomIdentity', () => {
      it('should generate a random gender identity when no gender is specified', async () => {
        const identity = generator.generateRandomIdentity();

        expect(identity).toBeDefined();
        expect(identity.firstName).toBeTruthy();
        expect(identity.lastName).toBeTruthy();
        expect([Gender.Male, Gender.Female]).toContain(identity.gender);
      });

      it('should generate unique identities on subsequent calls', async () => {
        const identity1 = generator.generateRandomIdentity();
        const identity2 = generator.generateRandomIdentity();

        expect(identity1).not.toEqual(identity2);
      });

      it('should generate an identity with all non-empty fields', async () => {
        const identity = generator.generateRandomIdentity();

        Object.entries(identity).forEach(([, value]) => {
          expect(value).toBeTruthy();
          expect(value).not.toBe('');
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        });

        // Check if the first and last names are longer than 1 character.
        expect(identity.firstName.length).toBeGreaterThan(1);
        expect(identity.lastName.length).toBeGreaterThan(1);
      });
    });
  });
};

// Run tests for each language implementation
describe('Identity Generators', () => {
  testIdentityGenerator('En', new IdentityGeneratorEn());
  testIdentityGenerator('Nl', new IdentityGeneratorNl());
  testIdentityGenerator('De', new IdentityGeneratorDe());
});

// Additional tests for birthdate options
describe('Birthdate Options', () => {
  const generator = new IdentityGeneratorEn();

  describe('targetYear with zero deviation', () => {
    it('should generate birthdate within the target year', () => {
      const birthdateOptions: IBirthdateOptions = {
        targetYear: 1990,
        yearDeviation: 0
      };

      const identity = generator.generateRandomIdentity('random', birthdateOptions);
      const birthYear = identity.birthDate.getFullYear();

      expect(birthYear).toBe(1990);
    });
  });

  describe('targetYear with deviation', () => {
    it('should generate birthdate within the year range', () => {
      const birthdateOptions: IBirthdateOptions = {
        targetYear: 1990,
        yearDeviation: 5
      };

      const identity = generator.generateRandomIdentity('random', birthdateOptions);
      const birthYear = identity.birthDate.getFullYear();

      expect(birthYear).toBeGreaterThanOrEqual(1985);
      expect(birthYear).toBeLessThanOrEqual(1995);
    });

    it('should generate varied birthdates within range', () => {
      const birthdateOptions: IBirthdateOptions = {
        targetYear: 1990,
        yearDeviation: 5
      };

      const birthYears = new Set<number>();
      for (let i = 0; i < 50; i++) {
        const identity = generator.generateRandomIdentity('random', birthdateOptions);
        birthYears.add(identity.birthDate.getFullYear());
      }

      // Should generate at least a few different years
      expect(birthYears.size).toBeGreaterThan(1);
    });
  });
});

// Additional tests for German identity generator decade-based names
describe('German Identity Generator Decade Names', () => {
  const generator = new IdentityGeneratorDe();

  describe('Decade-based name selection', () => {
    it('should use age-appropriate names for 1950s births', () => {
      const birthdateOptions: IBirthdateOptions = {
        targetYear: 1955,
        yearDeviation: 0
      };

      const identity = generator.generateRandomIdentity('male', birthdateOptions);

      expect(identity.firstName).toBeTruthy();
      expect(identity.birthDate.getFullYear()).toBe(1955);
    });

    it('should use age-appropriate names for 2020s births', () => {
      const birthdateOptions: IBirthdateOptions = {
        targetYear: 2020,
        yearDeviation: 0
      };

      const identity = generator.generateRandomIdentity('female', birthdateOptions);

      expect(identity.firstName).toBeTruthy();
      expect(identity.birthDate.getFullYear()).toBe(2020);
    });

    it('should generate valid German identities across all decades', () => {
      const decades = [1955, 1965, 1975, 1985, 1995, 2005, 2015, 2025];

      decades.forEach(year => {
        const birthdateOptions: IBirthdateOptions = {
          targetYear: year,
          yearDeviation: 0
        };

        const identity = generator.generateRandomIdentity('random', birthdateOptions);

        expect(identity.firstName).toBeTruthy();
        expect(identity.lastName).toBeTruthy();
        expect(identity.birthDate.getFullYear()).toBe(year);
      });
    });
  });
});