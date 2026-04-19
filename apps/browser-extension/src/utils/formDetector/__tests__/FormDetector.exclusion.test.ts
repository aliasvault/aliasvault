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
