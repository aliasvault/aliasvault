import { describe, it, expect } from 'vitest';

import { AppInfo } from './AppInfo';

describe('AppInfo', () => {
  describe('isVersionSupported', () => {
    it('should support exact version match', () => {
      expect(AppInfo.versionGreaterThanOrEqualTo('1.0.0', '1.0.0')).toBe(true);
    });

    it('should support higher patch versions', () => {
      expect(AppInfo.versionGreaterThanOrEqualTo('1.0.5', '1.0.0')).toBe(true);
      expect(AppInfo.versionGreaterThanOrEqualTo('1.0.10', '1.0.2')).toBe(true);
    });

    it('should support higher minor versions', () => {
      expect(AppInfo.versionGreaterThanOrEqualTo('1.2.0', '1.0.0')).toBe(true);
      expect(AppInfo.versionGreaterThanOrEqualTo('1.5.0', '1.3.0')).toBe(true);
    });

    it('should support higher major versions', () => {
      expect(AppInfo.versionGreaterThanOrEqualTo('2.0.0', '1.0.0')).toBe(true);
      expect(AppInfo.versionGreaterThanOrEqualTo('3.0.0', '2.5.1')).toBe(true);
    });

    it('should handle development versions', () => {
      expect(AppInfo.versionGreaterThanOrEqualTo('1.4.0', '1.4.0-dev')).toBe(true);
      expect(AppInfo.versionGreaterThanOrEqualTo('2.0.0-dev', '1.9.9')).toBe(true);
      expect(AppInfo.versionGreaterThanOrEqualTo('1.5.0-dev', '1.5.1')).toBe(false);
    });

    it('should reject lower versions', () => {
      expect(AppInfo.versionGreaterThanOrEqualTo('1.0.0', '1.0.1')).toBe(false);
      expect(AppInfo.versionGreaterThanOrEqualTo('1.0.0', '1.4.1')).toBe(false);
      expect(AppInfo.versionGreaterThanOrEqualTo('1.4.0', '1.5.0')).toBe(false);
      expect(AppInfo.versionGreaterThanOrEqualTo('1.9.9', '2.0.0')).toBe(false);
    });
  });
});
