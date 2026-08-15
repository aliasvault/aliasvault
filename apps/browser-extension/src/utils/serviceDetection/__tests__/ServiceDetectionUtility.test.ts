import { describe, it, expect } from 'vitest';

import { ServiceDetectionUtility } from '../ServiceDetectionUtility';

describe('ServiceDetectionUtility.isWebsiteUrl', () => {
  it.each([
    'https://example.com',
    'http://localhost:3000/login',
  ])('should accept %s', (url) => {
    expect(ServiceDetectionUtility.isWebsiteUrl(url)).toBe(true);
  });

  it.each([
    'chrome://newtab/',
    'chrome://settings/passwords',
    'about:blank',
    'about:preferences',
    'edge://settings',
    'brave://settings',
    'moz-extension://abc123/popup.html',
    'chrome-extension://abc123/popup.html',
    'file:///Users/test/index.html',
    '',
    'not a url',
  ])('should reject %s', (url) => {
    expect(ServiceDetectionUtility.isWebsiteUrl(url)).toBe(false);
  });
});

describe('ServiceDetectionUtility.getServiceInfoFromTab', () => {
  it('should detect service info for a regular website', () => {
    const info = ServiceDetectionUtility.getServiceInfoFromTab('https://www.github.com/login', 'Sign in to GitHub');
    expect(info.serviceUrl).toBe('https://www.github.com');
    expect(info.domain).toBe('github.com');
    expect(info.suggestedNames.length).toBeGreaterThan(0);
  });

  it('should return empty info for browser internal pages', () => {
    const info = ServiceDetectionUtility.getServiceInfoFromTab('chrome://newtab/', 'New Tab');
    expect(info).toEqual({
      suggestedNames: [],
      currentUrl: '',
      serviceUrl: '',
      domain: ''
    });
  });
});
