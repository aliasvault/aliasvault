import { describe, it, expect } from 'vitest';

import { FormDetector } from '../FormDetector';

import { createTestDom } from './TestUtils';

describe('FormDetector - Field Exclusion Patterns', () => {
  describe('Real-world scenario: Admin panel with search', () => {
    const htmlFile = 'exclusion-admin-panel.html';

    it('should not trigger autofill on "Search users..." field in admin panel', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const searchInput = document.getElementById('search');
      const formDetector = new FormDetector(document, searchInput as HTMLElement);

      // Should not detect as login form (this is the main use case from the user's issue)
      expect(formDetector.containsLoginForm()).toBe(false);
    });
  });

  describe('Real-world scenario: Settings page with token fields', () => {
    const htmlFile = 'exclusion-settings-tokens.html';

    it('should not trigger TOTP autofill on refresh token lifetime field', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const tokenInput = document.getElementById('refreshTokenShort');
      const formDetector = new FormDetector(document, tokenInput as HTMLElement);

      // Should not detect as TOTP form (token fields in settings are not TOTP codes)
      expect(formDetector.containsLoginForm()).toBe(false);
      expect(formDetector.getDetectedFieldType()).toBeNull();
    });

    it('should not trigger TOTP autofill on access token lifetime field', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const tokenInput = document.getElementById('accessTokenLifetime');
      const formDetector = new FormDetector(document, tokenInput as HTMLElement);

      // Should not detect as TOTP form
      expect(formDetector.containsLoginForm()).toBe(false);
      expect(formDetector.getDetectedFieldType()).toBeNull();
    });
  });

  describe('Real-world scenario: Test/widget tokenfield containing "token"', () => {
    const htmlFile = 'exclusion-test-tokenfield.html';

    it('should not detect a "test-tokenfield" widget input as TOTP', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const widgetInput = document.getElementById('active-input');
      const formDetector = new FormDetector(document, widgetInput as HTMLElement);

      /*
       * The TOTP include pattern matches "token" via substring, which would otherwise
       * hit the "test-tokenfield-input" class. The per-field exclude ('test') vetoes
       * it, so this widget should not be classified as a 2FA field.
       */
      expect(formDetector.containsLoginForm()).toBe(false);
      expect(formDetector.getDetectedFieldType()).toBeNull();
    });

    it('should not detect the placeholder editor input as TOTP either', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const placeholderInput = document.getElementById('placeholder-input');
      const formDetector = new FormDetector(document, placeholderInput as HTMLElement);

      expect(formDetector.containsLoginForm()).toBe(false);
      expect(formDetector.getDetectedFieldType()).toBeNull();
    });
  });

  /*
   * Exclusion words appearing in surrounding text (placeholder "Enter your configuration password")
   * must not veto a field that carries explicit credential signals (type="password" / autocomplete="current-password").
   */
  describe('Real-world scenario: "Load Configuration" dialog with password field', () => {
    const htmlFile = 'exclusion-config-password-dialog.html';

    it('should detect the dialog as a login form despite "configuration" placeholders', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const passwordInput = document.getElementById('password');
      const formDetector = new FormDetector(document, passwordInput as HTMLElement);

      expect(formDetector.containsLoginForm()).toBe(true);
    });

    it('should trigger autofill when clicking the type="password" field', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const passwordInput = document.getElementById('password');
      const formDetector = new FormDetector(document, passwordInput as HTMLElement);

      expect(formDetector.isAutofillTriggerableField()).toBe(true);

      const form = formDetector.getForm();
      expect(form?.passwordField).toBe(passwordInput);
    });

    it('should detect the login form when focusing the UUID field too', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const uuidInput = document.getElementById('uuid');
      const formDetector = new FormDetector(document, uuidInput as HTMLElement);

      expect(formDetector.containsLoginForm()).toBe(true);
    });
  });

  describe('Exclusion patterns should not affect legitimate login fields', () => {
    const htmlFile = 'exclusion-legitimate-login.html';

    it('should still detect username field in a real login form', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const usernameInput = document.getElementById('username');
      const formDetector = new FormDetector(document, usernameInput as HTMLElement);

      // Should detect as login form
      expect(formDetector.containsLoginForm()).toBe(true);

      // Should detect username field
      const form = formDetector.getForm();
      expect(form?.usernameField).toBe(usernameInput);
    });

    it('should still detect email field in a real login form', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const emailInput = document.getElementById('email');
      const formDetector = new FormDetector(document, emailInput as HTMLElement);

      // Should detect as login form
      expect(formDetector.containsLoginForm()).toBe(true);

      // Should detect email field
      const form = formDetector.getForm();
      expect(form?.emailField).toBe(emailInput);
    });
  });
});
