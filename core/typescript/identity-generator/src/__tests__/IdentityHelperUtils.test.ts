import { describe, it, expect } from 'vitest';
import { IdentityHelperUtils } from '../utils/IdentityHelperUtils';

describe('IdentityHelperUtils', () => {
  describe('normalizeBirthDate', () => {
    it('should return empty string for undefined input', () => {
      expect(IdentityHelperUtils.normalizeBirthDate(undefined)).toBe('');
    });

    it('should return empty string for empty string input', () => {
      expect(IdentityHelperUtils.normalizeBirthDate('')).toBe('');
    });

    it('should return empty string for default date (0001-01-01)', () => {
      expect(IdentityHelperUtils.normalizeBirthDate('0001-01-01')).toBe('');
    });

    it('should return empty string for invalid date', () => {
      expect(IdentityHelperUtils.normalizeBirthDate('invalid-date')).toBe('');
    });

    it('should strip time from ISO format date with T separator', () => {
      expect(IdentityHelperUtils.normalizeBirthDate('1976-05-18T08:24:15.000Z')).toBe('1976-05-18');
    });

    it('should strip time from date with space separator', () => {
      expect(IdentityHelperUtils.normalizeBirthDate('1976-05-18 08:24:15')).toBe('1976-05-18');
    });

    it('should return date as-is when already in correct format', () => {
      expect(IdentityHelperUtils.normalizeBirthDate('1976-05-18')).toBe('1976-05-18');
    });

    it('should handle pre-1970 dates correctly', () => {
      expect(IdentityHelperUtils.normalizeBirthDate('1955-03-24T00:00:00')).toBe('1955-03-24');
    });
  });

  describe('isValidBirthDate', () => {
    it('should return false for undefined input', () => {
      expect(IdentityHelperUtils.isValidBirthDate(undefined)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(IdentityHelperUtils.isValidBirthDate('')).toBe(false);
    });

    it('should return false for default date (0001-01-01)', () => {
      expect(IdentityHelperUtils.isValidBirthDate('0001-01-01')).toBe(false);
    });

    it('should return true for valid date', () => {
      expect(IdentityHelperUtils.isValidBirthDate('1976-05-18')).toBe(true);
    });

    it('should return true for valid ISO date', () => {
      expect(IdentityHelperUtils.isValidBirthDate('1976-05-18T08:24:15.000Z')).toBe(true);
    });
  });
});
