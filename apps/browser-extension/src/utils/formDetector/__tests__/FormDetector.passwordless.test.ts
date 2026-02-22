import { readFileSync } from 'fs';
import { join } from 'path';

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { FormDetector } from '@/utils/formDetector/FormDetector';

/**
 * Tests for passwordless authentication forms (email-only login/signup flows)
 */
describe('FormDetector passwordless authentication detection', () => {
  /**
   * Load the test HTML file
   */
  const loadTestHtml = (filename: string): string => {
    return readFileSync(join(__dirname, 'test-forms', filename), 'utf-8');
  };

  /**
   * Create a FormDetector instance
   */
  const createFormDetector = (htmlFile: string, elementId: string): FormDetector => {
    const html = loadTestHtml(htmlFile);
    const dom = new JSDOM(html, {
      url: 'http://localhost',
      runScripts: 'dangerously',
      resources: 'usable'
    });
    const document = dom.window.document;
    const element = document.getElementById(elementId);

    if (!element) {
      throw new Error(`Element with id "${elementId}" not found in test HTML`);
    }

    return new FormDetector(document, element);
  };

  describe('English passwordless signup form 1', () => {
    const htmlFile = 'en-signup-passwordless-1.html';

    it('should detect form as login form when focused on full name field', () => {
      const detector = createFormDetector(htmlFile, 'form-group--1');
      expect(detector.containsLoginForm()).toBe(true);
    });

    it('should detect form as login form when focused on email field', () => {
      const detector = createFormDetector(htmlFile, 'form-group--3');
      expect(detector.containsLoginForm()).toBe(true);
    });

    it('should detect email field as autofill triggerable', () => {
      const detector = createFormDetector(htmlFile, 'form-group--3');
      expect(detector.isAutofillTriggerableField()).toBe(true);
    });

    it('should NOT detect full name field as autofill triggerable (not a username/email/password field)', () => {
      const detector = createFormDetector(htmlFile, 'form-group--1');
      // Full name is not an autofill triggerable field (only username, email, password, and totp are)
      expect(detector.isAutofillTriggerableField()).toBe(false);
    });

    it('should get form fields correctly', () => {
      const detector = createFormDetector(htmlFile, 'form-group--3');
      const form = detector.getForm();

      expect(form).not.toBeNull();
      expect(form?.emailField).not.toBeNull();
      expect(form?.emailField?.id).toBe('form-group--3');
      expect(form?.fullNameField).not.toBeNull();
      expect(form?.fullNameField?.id).toBe('form-group--1');
      expect(form?.passwordField).toBeNull();
    });
  });

  describe('English passwordless login form 1', () => {
    const htmlFile = 'en-login-passwordless-1.html';

    it('should detect form as login form (containsLoginForm)', () => {
      const detector = createFormDetector(htmlFile, 'form-group--1');
      expect(detector.containsLoginForm()).toBe(true);
    });

    it('should detect email field as autofill triggerable', () => {
      const detector = createFormDetector(htmlFile, 'form-group--1');
      expect(detector.isAutofillTriggerableField()).toBe(true);
    });

    it('should detect field type as Email (not Username)', () => {
      const detector = createFormDetector(htmlFile, 'form-group--1');
      const fieldType = detector.getDetectedFieldType();

      // The email field should be detected as Email type, not Username
      expect(fieldType).toBe('email');
    });

    it('should get form fields correctly', () => {
      const detector = createFormDetector(htmlFile, 'form-group--1');
      const form = detector.getForm();

      expect(form).not.toBeNull();
      expect(form?.emailField).not.toBeNull();
      expect(form?.emailField?.id).toBe('form-group--1');
      expect(form?.passwordField).toBeNull();
      expect(form?.usernameField).toBeNull();
    });
  });
});
