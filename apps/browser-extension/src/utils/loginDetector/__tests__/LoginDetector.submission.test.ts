import { describe, it, expect, afterEach, vi } from 'vitest';

import { LoginDetector } from '../LoginDetector';

import { createTestEnvironment, cleanupTestEnvironment, setGlobalWindow } from './TestUtils';

import type { CapturedLogin } from '../types';

describe('LoginDetector form submission', () => {
  let detector: LoginDetector;

  afterEach(() => {
    if (detector) {
      detector.destroy();
    }
    cleanupTestEnvironment();
  });

  describe('credential capture', () => {
    it('should capture login when form with username and password is submitted', () => {
      const { document, window } = createTestEnvironment(`
        <html><body>
          <form id="login-form">
            <input type="text" id="username" name="username" value="testuser">
            <input type="password" id="password" name="password" value="testpass123">
            <button type="submit">Login</button>
          </form>
        </body></html>
      `);
      setGlobalWindow(window);

      detector = new LoginDetector(document);
      detector.initialize();

      const callback = vi.fn();
      detector.onLoginCapture(callback);

      const form = document.querySelector('form');
      form?.dispatchEvent(new window.Event('submit', { bubbles: true }));

      vi.runAllTimers();

      expect(callback).toHaveBeenCalledTimes(1);

      const capturedLogin: CapturedLogin = callback.mock.calls[0][0];
      expect(capturedLogin.username).toBe('testuser');
      expect(capturedLogin.password).toBe('testpass123');
      expect(capturedLogin.domain).toBe('example.com');
      expect(capturedLogin.url).toBe('https://example.com/login');
      expect(capturedLogin.timestamp).toBeGreaterThan(0);
    });

    it('should capture login with email field as username', () => {
      const { document, window } = createTestEnvironment(`
        <html><body>
          <form>
            <input type="email" id="email" name="email" value="user@example.com">
            <input type="password" id="password" name="password" value="password123">
            <button type="submit">Login</button>
          </form>
        </body></html>
      `);
      setGlobalWindow(window);

      detector = new LoginDetector(document);
      detector.initialize();

      const callback = vi.fn();
      detector.onLoginCapture(callback);

      const form = document.querySelector('form');
      form?.dispatchEvent(new window.Event('submit', { bubbles: true }));

      vi.runAllTimers();

      expect(callback).toHaveBeenCalledTimes(1);
      const capturedLogin: CapturedLogin = callback.mock.calls[0][0];
      expect(capturedLogin.username).toBe('user@example.com');
    });

    it('should extract suggested name from page', () => {
      const { document, window } = createTestEnvironment(`
        <html>
          <head><title>Login - My Awesome Service</title></head>
          <body>
            <form>
              <input type="text" id="username" value="testuser">
              <input type="password" id="password" value="testpass">
            </form>
          </body>
        </html>
      `);
      setGlobalWindow(window);

      detector = new LoginDetector(document);
      detector.initialize();

      const callback = vi.fn();
      detector.onLoginCapture(callback);

      const form = document.querySelector('form');
      form?.dispatchEvent(new window.Event('submit', { bubbles: true }));

      vi.runAllTimers();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].suggestedName).toBeDefined();
    });
  });

  describe('empty fields', () => {
    it('should not capture when password field is empty', () => {
      const { document, window } = createTestEnvironment(`
        <html><body>
          <form>
            <input type="text" id="username" value="testuser">
            <input type="password" id="password" value="">
            <button type="submit">Login</button>
          </form>
        </body></html>
      `);
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

    it('should not capture when username field is empty', () => {
      const { document, window } = createTestEnvironment(`
        <html><body>
          <form>
            <input type="text" id="username" value="">
            <input type="password" id="password" value="testpass">
            <button type="submit">Login</button>
          </form>
        </body></html>
      `);
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

    it('should not capture when form has no password field', () => {
      const { document, window } = createTestEnvironment(`
        <html><body>
          <form>
            <input type="text" id="username" value="testuser">
            <input type="text" id="search" value="query">
            <button type="submit">Search</button>
          </form>
        </body></html>
      `);
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

  describe('multiple forms', () => {
    it('should monitor multiple forms on the page', () => {
      const { document, window } = createTestEnvironment(`
        <html><body>
          <form id="form1">
            <input type="text" value="user1">
            <input type="password" value="pass1">
          </form>
          <form id="form2">
            <input type="text" value="user2">
            <input type="password" value="pass2">
          </form>
        </body></html>
      `);
      setGlobalWindow(window);

      detector = new LoginDetector(document);
      detector.initialize();

      const callback = vi.fn();
      detector.onLoginCapture(callback);

      // Submit first form
      const form1 = document.getElementById('form1');
      form1?.dispatchEvent(new window.Event('submit', { bubbles: true }));
      vi.advanceTimersByTime(100);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].username).toBe('user1');

      // Wait to avoid debouncing
      vi.advanceTimersByTime(5000);

      // Submit second form
      const form2 = document.getElementById('form2');
      form2?.dispatchEvent(new window.Event('submit', { bubbles: true }));
      vi.advanceTimersByTime(100);

      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback.mock.calls[1][0].username).toBe('user2');
    });
  });
});
