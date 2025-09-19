import { describe, it, expect } from 'vitest';

import { FormDetector } from '../FormDetector';

import { createTestDom } from './TestUtils';

describe('FormDetector generic tests', () => {
  describe('Invalid form not detected as login form 1', () => {
    const htmlFile = 'invalid-form1.html';

    it('should not detect any forms', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;
      const formDetector = new FormDetector(document);
      const form = formDetector.containsLoginForm();
      expect(form).toBe(false);
    });
  });

  describe('Invalid form not detected as login form 2', () => {
    const htmlFile = 'invalid-form2.html';

    it('should not detect any forms even when clicking search input', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      // Pass the search input as the clicked element to test if it's still not detected as a login form.
      const searchInput = document.getElementById('js-issues-search');
      const formDetector = new FormDetector(document, searchInput as HTMLElement);
      const form = formDetector.containsLoginForm();
      expect(form).toBe(false);
    });
  });

  describe('Form with autocomplete="off" still detected', () => {
    const htmlFile = 'autocomplete-off.html';

    it('should still detect form with autocomplete="off" on email field', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;
      const formDetector = new FormDetector(document);
      const form = formDetector.containsLoginForm();
      expect(form).toBe(true);
    });
  });

  describe('Form with display:none not detected', () => {
    const htmlFile = 'display-none.html';

    it('should not detect form with display:none', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;
      const formDetector = new FormDetector(document);
      const form = formDetector.containsLoginForm();
      expect(form).toBe(false);
    });
  });

  describe('Form with visibility:hidden not detected', () => {
    const htmlFile = 'visibility-hidden.html';

    it('should not detect form with visibility:hidden', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;
      const formDetector = new FormDetector(document);
      const form = formDetector.containsLoginForm();
      expect(form).toBe(false);
    });
  });

  describe('Form with opacity:0 not detected', () => {
    const htmlFile = 'opacity-zero.html';

    it('should not detect form with opacity:0', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;
      const formDetector = new FormDetector(document);
      const form = formDetector.containsLoginForm();
      expect(form).toBe(false);
    });
  });

  describe('Nested custom elements (parent-child duplicate prevention)', () => {
    describe('TrueNAS-style nested custom elements', () => {
      const htmlFile = 'nested-custom-elements.html';

      it('should not detect both parent custom element and child input as separate password fields', () => {
        const dom = createTestDom(htmlFile);
        const document = dom.window.document;

        // Click on the actual password input element
        const passwordInput = document.getElementById('password-field');
        const formDetector = new FormDetector(document, passwordInput as HTMLElement);

        // Get the detected form
        const form = formDetector.getForm();
        expect(form).toBeTruthy();

        // Should detect only ONE password field
        expect(form?.passwordField).toBeTruthy();
        expect(form?.passwordConfirmField).toBeFalsy();

        // The detected password field should be the actual input element
        expect(form?.passwordField?.tagName.toLowerCase()).toBe('input');
        expect(form?.passwordField?.type).toBe('password');
        expect(form?.passwordField?.id).toBe('password-field');
      });

      it('should detect username field correctly without duplication', () => {
        const dom = createTestDom(htmlFile);
        const document = dom.window.document;

        const usernameInput = document.getElementById('username-field');
        const formDetector = new FormDetector(document, usernameInput as HTMLElement);

        const form = formDetector.getForm();
        expect(form).toBeTruthy();

        // Should detect the username field
        expect(form?.usernameField).toBeTruthy();
        expect(form?.usernameField?.tagName.toLowerCase()).toBe('input');
        expect(form?.usernameField?.id).toBe('username-field');
      });
    });

    describe('Nested custom elements with actual password confirm field', () => {
      const htmlFile = 'nested-custom-elements-confirm.html';

      it('should correctly identify actual password confirm fields vs parent-child duplicates', () => {
        const dom = createTestDom(htmlFile);
        const document = dom.window.document;

        const passwordElement = document.getElementById('password-field');
        const formDetector = new FormDetector(document, passwordElement as HTMLElement);

        const form = formDetector.getForm();
        expect(form).toBeTruthy();

        // Should correctly detect both password and confirm as separate fields
        expect(form?.passwordField).toBeTruthy();
        expect(form?.passwordConfirmField).toBeTruthy();

        // Both should be actual input elements
        expect(form?.passwordField?.tagName.toLowerCase()).toBe('input');
        expect(form?.passwordConfirmField?.tagName.toLowerCase()).toBe('input');

        // They should be different elements
        expect(form?.passwordField?.id).toBe('password-field');
        expect(form?.passwordConfirmField?.id).toBe('password-confirm-field');
      });
    });
  });
});
