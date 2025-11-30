import { PasswordGenerator } from '../utils/PasswordGenerator';
import { describe, it, expect, beforeEach } from 'vitest';

describe('PasswordGenerator', () => {
  let generator: PasswordGenerator;

  beforeEach(() => {
    generator = new PasswordGenerator();
  });

  it('generates password with default settings', () => {
    const password = generator.generateRandomPassword();

    // Default length is 18
    expect(password.length).toBe(18);

    // Should contain at least one of each character type by default
    expect(password).toMatch(/[a-z]/);  // lowercase
    expect(password).toMatch(/[A-Z]/);  // uppercase
    expect(password).toMatch(/[0-9]/);  // numbers
    expect(password).toMatch(/[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/); // special
  });

  it('respects custom length setting', () => {
    const customLength = 24;
    const password = generator.setLength(customLength).generateRandomPassword();
    expect(password.length).toBe(customLength);
  });

  it('respects lowercase setting', () => {
    const password = generator.useLowercaseLetters(false).generateRandomPassword();
    expect(password).not.toMatch(/[a-z]/);
  });

  it('respects uppercase setting', () => {
    const password = generator.useUppercaseLetters(false).generateRandomPassword();
    expect(password).not.toMatch(/[A-Z]/);
  });

  it('respects numbers setting', () => {
    const password = generator.useNumericCharacters(false).generateRandomPassword();
    expect(password).not.toMatch(/[0-9]/);
  });

  it('respects special characters setting', () => {
    const password = generator.useSpecialCharacters(false).generateRandomPassword();
    expect(password).not.toMatch(/[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/);
  });

  it('generates different passwords on subsequent calls', () => {
    const password1 = generator.generateRandomPassword();
    const password2 = generator.generateRandomPassword();
    expect(password1).not.toBe(password2);
  });

  it('handles minimum character requirements', () => {
    let hasLower = false;
    let hasUpper = false;
    let hasNumber = false;
    let hasSpecial = false;

    // Generate 20 passwords and check if at least one contains all required characters
    for (let i = 0; i < 20; i++) {
      const password = generator.generateRandomPassword();

      hasLower = hasLower || /[a-z]/.test(password);
      hasUpper = hasUpper || /[A-Z]/.test(password);
      hasNumber = hasNumber || /[0-9]/.test(password);
      hasSpecial = hasSpecial || /[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(password);

      // Break early if we've found all character types
      if (hasLower && hasUpper && hasNumber && hasSpecial) {
        break;
      }
    }

    // Assert that we found at least one password with each character type
    expect(hasLower).toBe(true);
    expect(hasUpper).toBe(true);
    expect(hasNumber).toBe(true);
    expect(hasSpecial).toBe(true);
  });

  it('falls back to lowercase when all options disabled', () => {
    const password = generator
      .useLowercaseLetters(false)
      .useUppercaseLetters(false)
      .useNumericCharacters(false)
      .useSpecialCharacters(false)
      .generateRandomPassword();

    // Should fall back to lowercase
    expect(password).toMatch(/^[a-z]+$/);
  });

  it('maintains method chaining', () => {
    const result = generator
      .setLength(20)
      .useLowercaseLetters(true)
      .useUppercaseLetters(true)
      .useNumericCharacters(true)
      .useSpecialCharacters(true);

    expect(result).toBe(generator);
  });

  it('removes ambiguous characters when useNonAmbiguousCharacters is enabled', () => {
    /**
     * Generate 50 passwords to ensure statistical confidence
     * Check that none of the ambiguous characters appear:
     * - I, l, 1, | - vertical line lookalikes
     * - O, 0, o - circle lookalikes
     * - Z, z, 2 - similar appearance
     * - S, s, 5 - similar appearance
     * - B, b, 8 - similar appearance
     * - G, g, 6 - similar appearance
     * - Brackets, braces, parentheses
     * - Quotes
     * - Punctuation pairs
     * - Dashes
     */
    for (let i = 0; i < 50; i++) {
      const password = generator
        .setLength(32)
        .useNonAmbiguousCharacters(true)
        .generateRandomPassword();

      expect(password).not.toMatch(/[Il1|]/);
      expect(password).not.toMatch(/[O0o]/);
      expect(password).not.toMatch(/[Zz2]/);
      expect(password).not.toMatch(/[Ss5]/);
      expect(password).not.toMatch(/[Bb8]/);
      expect(password).not.toMatch(/[Gg6]/);
      expect(password).not.toMatch(/[\\[\\]{}()<>]/);
      expect(password).not.toMatch(/['"`]/);
      expect(password).not.toMatch(/[;:,.]/);
      expect(password).not.toMatch(/[_-]/);
    }
  });

  it('still generates valid passwords with non-ambiguous characters enabled', () => {
    const password = generator
      .setLength(20)
      .useNonAmbiguousCharacters(true)
      .generateRandomPassword();

    expect(password.length).toBe(20);
    // Should still contain allowed characters
    expect(password.length).toBeGreaterThan(0);
  });

  it('includes ambiguous characters when useNonAmbiguousCharacters is disabled', () => {
    // Generate multiple passwords and check if at least one contains ambiguous characters
    let foundAmbiguous = false;

    for (let i = 0; i < 100; i++) {
      const password = generator
        .setLength(32)
        .useNonAmbiguousCharacters(false)
        .generateRandomPassword();

      // Check if any ambiguous characters are present
      if (/[Il1O0oZzSsBbGg2568|[\]{}()<>;:,.`'"_-]/.test(password)) {
        foundAmbiguous = true;
        break;
      }
    }

    expect(foundAmbiguous).toBe(true);
  });
});