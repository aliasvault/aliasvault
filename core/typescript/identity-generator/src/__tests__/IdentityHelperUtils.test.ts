import { describe, it, expect } from 'vitest';
import { IdentityHelperUtils } from '../utils/IdentityHelperUtils';

describe('IdentityHelperUtils', () => {
  describe('normalizeBirthDateForDisplay', () => {
    it('should return empty string for undefined input', () => {
      expect(IdentityHelperUtils.normalizeBirthDateForDisplay(undefined)).toBe('');
    });

    it('should return empty string for default date', () => {
      expect(IdentityHelperUtils.normalizeBirthDateForDisplay('0001-01-01')).toBe('');
    });

    it('should strip time from ISO format date', () => {
      expect(IdentityHelperUtils.normalizeBirthDateForDisplay('1976-05-18T08:24:15.000Z')).toBe('1976-05-18');
    });

    it('should handle date with space separator', () => {
      expect(IdentityHelperUtils.normalizeBirthDateForDisplay('1976-05-18 08:24:15')).toBe('1976-05-18');
    });

    it('should handle date without time', () => {
      expect(IdentityHelperUtils.normalizeBirthDateForDisplay('1976-05-18')).toBe('1976-05-18');
    });
  });

  describe('normalizeBirthDateForDb', () => {
    it('should return default date for undefined input', () => {
      expect(IdentityHelperUtils.normalizeBirthDateForDb(undefined)).toBe('0001-01-01 00:00:00');
    });

    it('should return default date for empty string', () => {
      expect(IdentityHelperUtils.normalizeBirthDateForDb('')).toBe('0001-01-01 00:00:00');
    });

    it('should return default date for invalid date', () => {
      expect(IdentityHelperUtils.normalizeBirthDateForDb('invalid-date')).toBe('0001-01-01 00:00:00');
    });

    it('should normalize ISO format date with time to space-separated format', () => {
      expect(IdentityHelperUtils.normalizeBirthDateForDb('1976-05-18T08:24:15.000Z')).toBe('1976-05-18 00:00:00');
    });

    it('should preserve date with space separator and time', () => {
      expect(IdentityHelperUtils.normalizeBirthDateForDb('1976-05-18 08:24:15')).toBe('1976-05-18 00:00:00');
    });

    it('should add default time to date without time', () => {
      expect(IdentityHelperUtils.normalizeBirthDateForDb('1976-05-18')).toBe('1976-05-18 00:00:00');
    });
  });
});