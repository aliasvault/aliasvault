import { describe, expect, it } from 'vitest';

import { FormField, testField } from './TestUtils';

describe('FormDetector TOTP tests', () => {
  it('contains tests for TOTP field detection', () => {
    /**
     * This test suite uses testField() helper function
     * to test TOTP/2FA field detection for various forms.
     * The actual test implementations are in the helper functions.
     * This test is just to ensure the test suite is working and to satisfy the linter.
     */
    expect(true).toBe(true);
  });

  describe('English TOTP form 1 detection', () => {
    const htmlFile = 'en-totp-form1.html';

    testField(FormField.Totp, 'otp', htmlFile);
  });

  describe('English TOTP form 2 detection (Nintendo style)', () => {
    const htmlFile = 'en-totp-form2.html';

    testField(FormField.Totp, 'two-fa-challenge-authenticator_pc_input_0', htmlFile);
  });

  describe('English TOTP form 3 detection (Google Authenticator style)', () => {
    const htmlFile = 'en-totp-form3.html';

    testField(FormField.Totp, 'google_code', htmlFile);
  });
});
