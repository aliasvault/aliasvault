import { describe, it, expect, afterEach, vi } from 'vitest';

import { LoginDetector } from '../LoginDetector';

import { createTestEnvironment, cleanupTestEnvironment, setGlobalWindow } from './TestUtils';

describe('LoginDetector lifecycle', () => {
  let detector: LoginDetector;

  afterEach(() => {
    if (detector) {
      detector.destroy();
    }
    cleanupTestEnvironment();
  });

  describe('constructor', () => {
    it('should create an instance with provided document', () => {
      const { document, window } = createTestEnvironment('<html><body></body></html>');
      setGlobalWindow(window);

      detector = new LoginDetector(document);
      expect(detector).toBeInstanceOf(LoginDetector);
    });
  });

  describe('initialize', () => {
    it('should not initialize twice', () => {
      const { document, window } = createTestEnvironment('<html><body></body></html>');
      setGlobalWindow(window);

      detector = new LoginDetector(document);
      detector.initialize();
      detector.initialize(); // Second call should be no-op

      expect(detector).toBeInstanceOf(LoginDetector);
    });

    it('should skip initialization for excluded domains', () => {
      const { document, window } = createTestEnvironment(
        '<html><body><form><input type="password"></form></body></html>',
        'https://aliasvault.net/login'
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

    it('should allow localhost (for self-hosted users)', () => {
      const { document, window } = createTestEnvironment(
        `<html><body><form>
          <input type="text" name="user" value="testuser">
          <input type="password" name="pass" value="testpass">
        </form></body></html>`,
        'https://localhost/login'
      );
      setGlobalWindow(window);

      detector = new LoginDetector(document);
      detector.initialize();

      const callback = vi.fn();
      detector.onLoginCapture(callback);

      const form = document.querySelector('form');
      form?.dispatchEvent(new window.Event('submit', { bubbles: true }));

      vi.runAllTimers();
      expect(callback).toHaveBeenCalled();
    });

    it('should allow HTTP pages (user choice to use insecure sites)', () => {
      const { document, window } = createTestEnvironment(
        `<html><body><form>
          <input type="text" name="user" value="testuser">
          <input type="password" name="pass" value="testpass">
        </form></body></html>`,
        'http://example.com/login'
      );
      setGlobalWindow(window);

      detector = new LoginDetector(document);
      detector.initialize();

      const callback = vi.fn();
      detector.onLoginCapture(callback);

      const form = document.querySelector('form');
      form?.dispatchEvent(new window.Event('submit', { bubbles: true }));

      vi.runAllTimers();
      expect(callback).toHaveBeenCalled();
    });
  });

  describe('onLoginCapture', () => {
    it('should register a callback and return unsubscribe function', () => {
      const { document, window } = createTestEnvironment('<html><body></body></html>');
      setGlobalWindow(window);

      detector = new LoginDetector(document);
      const callback = vi.fn();

      const unsubscribe = detector.onLoginCapture(callback);

      expect(typeof unsubscribe).toBe('function');

      unsubscribe();
    });

    it('should allow multiple callbacks to be registered', () => {
      const { document, window } = createTestEnvironment('<html><body></body></html>');
      setGlobalWindow(window);

      detector = new LoginDetector(document);
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      detector.onLoginCapture(callback1);
      detector.onLoginCapture(callback2);

      // Both should be registered (functionality tested in submission tests)
    });
  });

  describe('destroy', () => {
    it('should clean up resources', () => {
      const { document, window } = createTestEnvironment('<html><body></body></html>');
      setGlobalWindow(window);

      detector = new LoginDetector(document);
      detector.initialize();
      detector.destroy();

      // After destroy, should be able to initialize again
      detector.initialize();
    });

    it('should clear all callbacks', () => {
      const { document, window } = createTestEnvironment(`
        <html><body>
          <form>
            <input type="text" id="username" value="testuser">
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

      detector.destroy();

      // Reinitialize and submit - callback should not be called
      detector.initialize();

      const form = document.querySelector('form');
      form?.dispatchEvent(new window.Event('submit', { bubbles: true }));

      vi.runAllTimers();
      expect(callback).not.toHaveBeenCalled();
    });
  });
});
