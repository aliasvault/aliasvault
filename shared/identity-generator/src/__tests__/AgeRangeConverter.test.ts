import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { convertAgeRangeToBirthdateOptions } from '../utils/AgeRangeConverter';

describe('AgeRangeConverter', () => {
  // Mock Date to ensure consistent test results
  const MOCK_CURRENT_YEAR = 2025;
  let originalDate: DateConstructor;

  beforeEach(() => {
    originalDate = global.Date;
    const mockDate = new Date(`${MOCK_CURRENT_YEAR}-01-01T00:00:00.000Z`);
    vi.spyOn(global, 'Date').mockImplementation((...args) => {
      if (args.length === 0) {
        return mockDate;
      }
      return new originalDate(...args as []);
    }) as unknown as DateConstructor;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('convertAgeRangeToBirthdateOptions', () => {
    it('should return null for "random" age range', () => {
      const result = convertAgeRangeToBirthdateOptions('random');
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = convertAgeRangeToBirthdateOptions('');
      expect(result).toBeNull();
    });

    it('should convert "21-25" correctly', () => {
      const result = convertAgeRangeToBirthdateOptions('21-25');
      expect(result).toEqual({
        targetYear: 2002, // 2025 - 23 (middle of 21-25)
        yearDeviation: 2  // (25-21)/2
      });
    });

    it('should convert "26-30" correctly', () => {
      const result = convertAgeRangeToBirthdateOptions('26-30');
      expect(result).toEqual({
        targetYear: 1997, // 2025 - 28 (middle of 26-30)
        yearDeviation: 2  // (30-26)/2
      });
    });

    it('should convert "31-35" correctly', () => {
      const result = convertAgeRangeToBirthdateOptions('31-35');
      expect(result).toEqual({
        targetYear: 1992, // 2025 - 33 (middle of 31-35)
        yearDeviation: 2  // (35-31)/2
      });
    });

    it('should convert "61-65" correctly', () => {
      const result = convertAgeRangeToBirthdateOptions('61-65');
      expect(result).toEqual({
        targetYear: 1962, // 2025 - 63 (middle of 61-65)
        yearDeviation: 2  // (65-61)/2
      });
    });

    it('should handle odd range sizes correctly', () => {
      const result = convertAgeRangeToBirthdateOptions('20-24');
      expect(result).toEqual({
        targetYear: 2003, // 2025 - 22 (middle of 20-24)
        yearDeviation: 2  // floor((24-20)/2)
      });
    });

    it('should return null for invalid format (missing dash)', () => {
      const result = convertAgeRangeToBirthdateOptions('2125');
      expect(result).toBeNull();
    });

    it('should return null for invalid format (too many parts)', () => {
      const result = convertAgeRangeToBirthdateOptions('21-25-30');
      expect(result).toBeNull();
    });

    it('should return null for non-numeric values', () => {
      const result = convertAgeRangeToBirthdateOptions('abc-def');
      expect(result).toBeNull();
    });

    it('should return null for partially numeric values', () => {
      const result = convertAgeRangeToBirthdateOptions('21-abc');
      expect(result).toBeNull();
    });

    it('should handle single-year ranges', () => {
      const result = convertAgeRangeToBirthdateOptions('25-25');
      expect(result).toEqual({
        targetYear: 2000, // 2025 - 25
        yearDeviation: 0  // (25-25)/2
      });
    });
  });
});
