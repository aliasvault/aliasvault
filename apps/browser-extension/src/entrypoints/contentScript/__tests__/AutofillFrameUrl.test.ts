import { describe, expect, it } from 'vitest';

import {
  type AutofillFrameLocation,
  getCurrentAutofillFrameUrl
} from '../AutofillFrameUrl';

/**
 * Build the minimal Location shape used by the autofill frame URL guard.
 */
const frameLocation = (protocol: string, hostname: string, href: string): AutofillFrameLocation => ({
  protocol,
  hostname,
  href,
});

describe('AutofillFrameUrl', () => {
  it('allows http and https frame URLs with a hostname', () => {
    expect(getCurrentAutofillFrameUrl(frameLocation(
      'https:',
      'login.example.com',
      'https://login.example.com/sign-in',
    ))).toBe('https://login.example.com/sign-in');

    expect(getCurrentAutofillFrameUrl(frameLocation(
      'http:',
      'localhost',
      'http://localhost:3000/login',
    ))).toBe('http://localhost:3000/login');
  });

  it('rejects inherited or opaque non-web frame URLs', () => {
    expect(getCurrentAutofillFrameUrl(frameLocation('about:', '', 'about:blank'))).toBeNull();
    expect(getCurrentAutofillFrameUrl(frameLocation('about:', '', 'about:srcdoc'))).toBeNull();
    expect(getCurrentAutofillFrameUrl(frameLocation('blob:', '', 'blob:https://attacker.example/id'))).toBeNull();
    expect(getCurrentAutofillFrameUrl(frameLocation('data:', '', 'data:text/html,<input>'))).toBeNull();
  });

  it('rejects web protocols without a hostname', () => {
    expect(getCurrentAutofillFrameUrl(frameLocation('https:', '', 'https://'))).toBeNull();
  });
});
