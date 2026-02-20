import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Credential } from '@/utils/dist/core/models/vault';

import { FormDetector } from '../FormDetector';
import { FormFiller } from '../FormFiller';

import { createTestDom, createMockCredential, wasTriggerCalledFor } from './TestUtils';

/**
 * Tests for Dutch login form with multiple hidden fields and session options.
 */
describe('Dutch login form 1 detection and filling', () => {
  const htmlFile = 'nl-login-form1.html';

  describe('Field detection', () => {
    it('should detect username field despite autocomplete="off"', () => {
      const dom = createTestDom(htmlFile);
      const doc = dom.window.document;

      // Get the username input field
      const usernameInput = doc.getElementById('login_form_user') as HTMLInputElement;
      expect(usernameInput).not.toBeNull();
      expect(usernameInput.getAttribute('autocomplete')).toBe('off');

      // Create form detector with username field focused
      const formDetector = new FormDetector(doc, usernameInput);
      const detectedFields = formDetector.getForm();

      // Verify username field is detected despite autocomplete="off"
      expect(detectedFields?.usernameField).toBe(usernameInput);
      expect(detectedFields?.usernameField?.id).toBe('login_form_user');
    });

    it('should detect password field with autocomplete="current-password"', () => {
      const dom = createTestDom(htmlFile);
      const doc = dom.window.document;

      // Get the password input field
      const passwordInput = doc.getElementById('login_form_password') as HTMLInputElement;
      expect(passwordInput).not.toBeNull();
      expect(passwordInput.getAttribute('autocomplete')).toBe('current-password');

      // Create form detector with password field focused
      const formDetector = new FormDetector(doc, passwordInput);
      const detectedFields = formDetector.getForm();

      // Verify password field is detected
      expect(detectedFields?.passwordField).toBe(passwordInput);
      expect(detectedFields?.passwordField?.id).toBe('login_form_password');
    });

    it('should not detect hidden fields as login fields', () => {
      const dom = createTestDom(htmlFile);
      const doc = dom.window.document;

      const usernameInput = doc.getElementById('login_form_user') as HTMLInputElement;
      const formDetector = new FormDetector(doc, usernameInput);
      const detectedFields = formDetector.getForm();

      // Verify hidden fields are not detected
      const hiddenLocation = doc.getElementById('login_form_location') as HTMLInputElement;
      const hiddenToken = doc.getElementById('login_form__token') as HTMLInputElement;

      expect(detectedFields?.usernameField).not.toBe(hiddenLocation);
      expect(detectedFields?.usernameField).not.toBe(hiddenToken);
      expect(detectedFields?.passwordField).not.toBe(hiddenLocation);
      expect(detectedFields?.passwordField).not.toBe(hiddenToken);
    });

    it('should not detect session option fields as login fields', () => {
      const dom = createTestDom(htmlFile);
      const doc = dom.window.document;

      const usernameInput = doc.getElementById('login_form_user') as HTMLInputElement;
      const formDetector = new FormDetector(doc, usernameInput);
      const detectedFields = formDetector.getForm();

      // Verify session option fields are not detected as login fields
      const sessionNameInput = doc.getElementById('login_form_sessionName') as HTMLInputElement;
      const durationSelect = doc.getElementById('login_form_duration') as HTMLSelectElement;

      expect(detectedFields?.usernameField).not.toBe(sessionNameInput);
      expect(detectedFields?.usernameField).not.toBe(durationSelect);
      expect(detectedFields?.passwordField).not.toBe(sessionNameInput);
    });

    it('should detect both username and password fields from the same form', () => {
      const dom = createTestDom(htmlFile);
      const doc = dom.window.document;

      const usernameInput = doc.getElementById('login_form_user') as HTMLInputElement;
      const passwordInput = doc.getElementById('login_form_password') as HTMLInputElement;

      // Detect from username field focus
      const formDetector = new FormDetector(doc, usernameInput);
      const detectedFields = formDetector.getForm();

      // Both fields should be detected
      expect(detectedFields?.usernameField).toBe(usernameInput);
      expect(detectedFields?.passwordField).toBe(passwordInput);
    });
  });

  describe('Field filling', () => {
    let mockCredential: Credential;

    beforeEach(() => {
      mockCredential = createMockCredential();
    });

    it('should fill username field successfully', async () => {
      const dom = createTestDom(htmlFile);
      const doc = dom.window.document;

      const usernameInput = doc.getElementById('login_form_user') as HTMLInputElement;
      const formDetector = new FormDetector(doc, usernameInput);
      const detectedFields = formDetector.getForm();

      expect(detectedFields).not.toBeNull();

      if (detectedFields) {
        const triggerMock = vi.fn();
        const filler = new FormFiller(detectedFields, triggerMock);
        await filler.fillFields(mockCredential);

        // Verify username is filled
        expect(usernameInput.value).toBe('testuser');
        expect(wasTriggerCalledFor(triggerMock, usernameInput)).toBe(true);
      }
    });

    it('should fill password field successfully', async () => {
      const dom = createTestDom(htmlFile);
      const doc = dom.window.document;

      const passwordInput = doc.getElementById('login_form_password') as HTMLInputElement;
      const formDetector = new FormDetector(doc, passwordInput);
      const detectedFields = formDetector.getForm();

      expect(detectedFields).not.toBeNull();

      if (detectedFields) {
        const triggerMock = vi.fn();
        const filler = new FormFiller(detectedFields, triggerMock);
        await filler.fillFields(mockCredential);

        // Delay for password filling (character-by-character)
        await new Promise(resolve => setTimeout(resolve, 150));

        // Verify password is filled
        expect(passwordInput.value).toBe('testpass');
        expect(wasTriggerCalledFor(triggerMock, passwordInput)).toBe(true);
      }
    });

    it('should fill both username and password fields without filling other fields', async () => {
      const dom = createTestDom(htmlFile);
      const doc = dom.window.document;

      const usernameInput = doc.getElementById('login_form_user') as HTMLInputElement;
      const passwordInput = doc.getElementById('login_form_password') as HTMLInputElement;
      const sessionNameInput = doc.getElementById('login_form_sessionName') as HTMLInputElement;
      const hiddenLocation = doc.getElementById('login_form_location') as HTMLInputElement;

      const formDetector = new FormDetector(doc, usernameInput);
      const detectedFields = formDetector.getForm();

      expect(detectedFields).not.toBeNull();

      if (detectedFields) {
        const triggerMock = vi.fn();
        const filler = new FormFiller(detectedFields, triggerMock);
        await filler.fillFields(mockCredential);

        // Delay for password filling
        await new Promise(resolve => setTimeout(resolve, 150));

        // Verify correct fields are filled
        expect(usernameInput.value).toBe('testuser');
        expect(passwordInput.value).toBe('testpass');

        // Verify other fields are NOT filled
        expect(sessionNameInput.value).toBe('');
        expect(hiddenLocation.value).toBe('https://example.com/');

        // Verify trigger events were called for the correct fields only
        expect(wasTriggerCalledFor(triggerMock, usernameInput)).toBe(true);
        expect(wasTriggerCalledFor(triggerMock, passwordInput)).toBe(true);
        expect(wasTriggerCalledFor(triggerMock, sessionNameInput)).toBe(false);
        expect(wasTriggerCalledFor(triggerMock, hiddenLocation)).toBe(false);
      }
    });

    it('should handle form with credential containing email', async () => {
      const dom = createTestDom(htmlFile);
      const doc = dom.window.document;

      const usernameInput = doc.getElementById('login_form_user') as HTMLInputElement;
      const formDetector = new FormDetector(doc, usernameInput);
      const detectedFields = formDetector.getForm();

      expect(detectedFields).not.toBeNull();

      if (detectedFields) {
        const triggerMock = vi.fn();
        const filler = new FormFiller(detectedFields, triggerMock);

        // Credential with email should use username if username field exists
        await filler.fillFields(mockCredential);

        // Username field should be filled with username, not email
        expect(usernameInput.value).toBe('testuser');
        expect(usernameInput.value).not.toBe('test@example.com');
      }
    });
  });

  describe('Edge cases and regressions', () => {
    it('should only fill the actual username field, not hidden fields that might match patterns', async () => {
      const dom = createTestDom(htmlFile);
      const doc = dom.window.document;

      const usernameInput = doc.getElementById('login_form_user') as HTMLInputElement;
      const formDetector = new FormDetector(doc, usernameInput);
      const detectedFields = formDetector.getForm();

      expect(detectedFields).not.toBeNull();

      if (detectedFields) {
        const triggerMock = vi.fn();
        const filler = new FormFiller(detectedFields, triggerMock);
        await filler.fillFields(createMockCredential());

        // Check that only the visible username field was filled
        const allInputs = Array.from(doc.querySelectorAll('input[type="text"]')) as HTMLInputElement[];
        const filledInputs = allInputs.filter(input => input.value !== '');

        /*
         * Should have exactly one filled text input (the username field)
         * Session name field should remain empty
         */
        expect(filledInputs.length).toBe(1);
        expect(filledInputs[0]).toBe(usernameInput);
      }
    });

    it('should handle form detection when clicking on username field with multiple inputs nearby', () => {
      const dom = createTestDom(htmlFile);
      const doc = dom.window.document;

      // Simulate clicking the username field
      const usernameInput = doc.getElementById('login_form_user') as HTMLInputElement;
      const formDetector = new FormDetector(doc, usernameInput);

      // Form should be detected as a login form
      expect(formDetector.containsLoginForm()).toBe(true);

      const detectedFields = formDetector.getForm();

      // Should detect exactly the right fields, not extras
      expect(detectedFields?.usernameField).toBeTruthy();
      expect(detectedFields?.passwordField).toBeTruthy();
      expect(detectedFields?.emailField).toBeFalsy(); // No separate email field
      expect(detectedFields?.passwordConfirmField).toBeFalsy(); // No password confirm
    });
  });
});
