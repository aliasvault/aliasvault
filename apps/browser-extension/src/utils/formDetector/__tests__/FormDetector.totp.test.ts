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

  describe('English TOTP form 4 detection (Organizr style)', () => {
    const htmlFile = 'en-totp-form4.html';

    testField(FormField.Totp, 'tfaCode', htmlFile);
  });

  describe('English TOTP form 5 detection (Zenarmor OTP input)', () => {
    const htmlFile = 'en-totp-form5.html';

    testField(FormField.Totp, 'otp-input-0', htmlFile);
  });

  describe('English TOTP form 6 detection (Bitwarden Community)', () => {
    const htmlFile = 'en-totp-form6.html';

    testField(FormField.Totp, 'login-second-factor', htmlFile);
  });

  describe('English TOTP form 7 detection (Riot Games)', () => {
    const htmlFile = 'en-totp-form7.html';

    testField(FormField.Totp, 'riot-mfa-0', htmlFile);
  });
});
