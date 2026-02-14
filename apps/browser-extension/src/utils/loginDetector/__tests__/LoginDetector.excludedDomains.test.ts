import { describe, it, expect, afterEach, vi } from 'vitest';

import { LoginDetector } from '../LoginDetector';

import { createTestEnvironment, cleanupTestEnvironment, setGlobalWindow } from './TestUtils';

describe('LoginDetector excluded domains', () => {
  let detector: LoginDetector;

  afterEach(() => {
    if (detector) {
      detector.destroy();
    }
    cleanupTestEnvironment();
  });

  const excludedUrls = [
    'https://aliasvault.net/login',
    'https://subdomain.aliasvault.net/login',
    'https://127.0.0.1/login',
    'https://0.0.0.0/login',
  ];

  excludedUrls.forEach((url) => {
    it(`should skip ${url}`, () => {
      const { document, window } = createTestEnvironment(
        `<html><body>
          <form>
            <input type="text" value="user">
            <input type="password" value="pass">
          </form>
        </body></html>`,
        url
      );
      setGlobalWindow(window);

      detector = new LoginDetector(document);
      detector.initialize();

      const callback = vi.fn();
      detector.onLoginCapture(callback);

      const form = document.querySelector('form');
      form?.dispatchEvent(new window.Event('submit', { bubbles: true }));

      vi.runAllTimers();
      expect(callback).not.toHaveBeenCalled();
    });
  });
});
