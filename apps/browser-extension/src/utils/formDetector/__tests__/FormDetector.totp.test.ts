import { readFileSync } from 'fs';
import { join } from 'path';

import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it } from 'vitest';

import { FormDetector } from '@/utils/formDetector/FormDetector';
import { DetectedFieldType } from '@/utils/formDetector/types/FormFields';

import { FormField, testField, createTestDom } from './TestUtils';

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

  describe('English TOTP form 8 detection (MFA Authenticator Add)', () => {
    const htmlFile = 'en-totp-form8.html';

    testField(FormField.Totp, 'code', htmlFile);
  });

  describe('English TOTP form 9 detection (InfinityFree 2FA Setup)', () => {
    const htmlFile = 'en-totp-form9.html';

    testField(FormField.Totp, 'code', htmlFile);
  });

  describe('English TOTP form 10 detection (InfinityFree 2FA Challenge)', () => {
    const htmlFile = 'en-totp-form10.html';

    testField(FormField.Totp, 'code', htmlFile);
  });

  describe('English TOTP form 11 detection (Microsoft Entra ID 2FA)', () => {
    const htmlFile = 'en-totp-form11.html';
    let document: Document;
    let formDetector: FormDetector;

    beforeEach(() => {
      const dom = createTestDom(htmlFile);
      document = dom.window.document;
    });

    testField(FormField.Totp, 'idTxtBx_SAOTCC_OTC', htmlFile);

    it('should detect the 2FA code input field as TOTP', () => {
      const totpInput = document.getElementById('idTxtBx_SAOTCC_OTC') as HTMLInputElement;
      expect(totpInput).toBeTruthy();

      formDetector = new FormDetector(document, totpInput);

      const detectedType = formDetector.getDetectedFieldType();
      expect(detectedType).toBe(DetectedFieldType.Totp);
    });

    it('should find the TOTP field when searching from form', () => {
      formDetector = new FormDetector(document, document.body);

      const form = formDetector.getForm();
      expect(form?.totpField).toBeTruthy();
      expect(form?.totpField?.id).toBe('idTxtBx_SAOTCC_OTC');
    });

    it('should detect TOTP field with maxlength=6', () => {
      const totpInput = document.getElementById('idTxtBx_SAOTCC_OTC') as HTMLInputElement;
      expect(totpInput.maxLength).toBe(6);
      expect(totpInput.type).toBe('tel');
    });

    it('should recognize form contains login fields for TOTP', () => {
      formDetector = new FormDetector(document, document.body);

      const containsLogin = formDetector.containsLoginForm();
      expect(containsLogin).toBe(true);
    });

    it('should find hidden mfaAuthMethod input', () => {
      const mfaMethod = document.querySelector('input[name="mfaAuthMethod"]') as HTMLInputElement;
      expect(mfaMethod).toBeTruthy();
      expect(mfaMethod.value).toBe('PhoneAppOTP');
    });

    it('should find the submit button', () => {
      const submitBtn = document.getElementById('idSubmit_SAOTCC_Continue') as HTMLInputElement;
      expect(submitBtn).toBeTruthy();
      expect(submitBtn.type).toBe('submit');
      expect(submitBtn.value).toBe('Verify');
    });

    it('should detect aria-label for accessibility', () => {
      const totpInput = document.getElementById('idTxtBx_SAOTCC_OTC') as HTMLInputElement;
      expect(totpInput.getAttribute('aria-label')).toBe('Code');
    });

    it('should have autocomplete disabled', () => {
      const totpInput = document.getElementById('idTxtBx_SAOTCC_OTC') as HTMLInputElement;
      expect(totpInput.autocomplete).toBe('off');
    });

    it('should be marked as required', () => {
      const totpInput = document.getElementById('idTxtBx_SAOTCC_OTC') as HTMLInputElement;
      expect(totpInput.getAttribute('aria-required')).toBe('true');
    });

    it('should have proper ARIA descriptions', () => {
      const totpInput = document.getElementById('idTxtBx_SAOTCC_OTC') as HTMLInputElement;
      const describedBy = totpInput.getAttribute('aria-describedby');
      expect(describedBy).toContain('idDiv_SAOTCC_Description');
    });
  });

  describe('Email verification form should NOT be detected as TOTP', () => {
    it('should NOT detect English email verification form as TOTP', () => {
      const htmlFile = 'en-email-verification-form1.html';
      const html = readFileSync(join(__dirname, 'test-forms', htmlFile), 'utf-8');
      const dom = new JSDOM(html, {
        url: 'http://localhost',
        runScripts: 'dangerously',
        resources: 'usable'
      });
      const document = dom.window.document;

      // Set focus on the first input
      const focusedElement = document.getElementById('email-verify-0');
      if (!focusedElement) {
        throw new Error('Focus element not found in test HTML');
      }

      // Create a new form detector with the focused element
      const formDetector = new FormDetector(document, focusedElement);
      const result = formDetector.getForm();

      /*
       * The form should NOT be detected at all (null) or at least totpField should be null
       * because this is an email verification form, not a TOTP/2FA form
       */
      expect(result?.totpField).toBeNull();
    });

    it('should NOT detect Dutch email verification form as TOTP', () => {
      const htmlFile = 'nl-email-verification-form1.html';
      const html = readFileSync(join(__dirname, 'test-forms', htmlFile), 'utf-8');
      const dom = new JSDOM(html, {
        url: 'http://localhost',
        runScripts: 'dangerously',
        resources: 'usable'
      });
      const document = dom.window.document;

      // Set focus on the first input
      const focusedElement = document.getElementById('nl-verify-0');
      if (!focusedElement) {
        throw new Error('Focus element not found in test HTML');
      }

      // Create a new form detector with the focused element
      const formDetector = new FormDetector(document, focusedElement);
      const result = formDetector.getForm();

      // The form should NOT be detected as TOTP because it's a Dutch email verification form
      expect(result?.totpField).toBeNull();
    });

    it('should NOT detect Riot Games email code form as TOTP', () => {
      const htmlFile = 'en-email-verification-form2.html';
      const html = readFileSync(join(__dirname, 'test-forms', htmlFile), 'utf-8');
      const dom = new JSDOM(html, {
        url: 'http://localhost',
        runScripts: 'dangerously',
        resources: 'usable'
      });
      const document = dom.window.document;

      // Set focus on the first input
      const focusedElement = document.getElementById('email-code-0');
      if (!focusedElement) {
        throw new Error('Focus element not found in test HTML');
      }

      // Create a new form detector with the focused element
      const formDetector = new FormDetector(document, focusedElement);
      const result = formDetector.getForm();

      /*
       * The form should NOT be detected as TOTP because it's an email code verification form
       * Even though it says "Verification Required", the text "code we've emailed to" and
       * "Resend code" link indicate it's email verification, not authenticator TOTP
       */
      expect(result?.totpField).toBeNull();
    });
  });
});
