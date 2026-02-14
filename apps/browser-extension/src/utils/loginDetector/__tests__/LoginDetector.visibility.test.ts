import { describe, it, expect, afterEach, vi } from 'vitest';

import { LoginDetector } from '../LoginDetector';

import { createTestEnvironment, cleanupTestEnvironment, setGlobalWindow } from './TestUtils';

import type { CapturedLogin } from '../types';

describe('LoginDetector visibility checks', () => {
  let detector: LoginDetector;

  afterEach(() => {
    if (detector) {
      detector.destroy();
    }
    cleanupTestEnvironment();
  });

  describe('hidden password fields', () => {
    it('should skip password fields with display:none', () => {
      const { document, window } = createTestEnvironment(`
        <html><body>
          <form>
            <input type="text" id="username" value="testuser">
            <input type="password" id="hidden-password" value="hiddenpass" style="display: none;">
            <input type="password" id="visible-password" value="visiblepass">
            <button type="submit">Login</button>
          </form>
        </body></html>
      `);

      window.getComputedStyle = vi.fn().mockImplementation((element: HTMLElement) => {
        if (element.id === 'hidden-password') {
          return { display: 'none', visibility: 'visible', opacity: '1' };
        }
        return { display: 'block', visibility: 'visible', opacity: '1' };
      });

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
      expect(capturedLogin.password).toBe('visiblepass');
    });

    it('should skip password fields with visibility:hidden', () => {
      const { document, window } = createTestEnvironment(`
        <html><body>
          <form>
            <input type="text" id="username" value="testuser">
            <input type="password" id="hidden-password" value="hiddenpass">
            <input type="password" id="visible-password" value="visiblepass">
          </form>
        </body></html>
      `);

      window.getComputedStyle = vi.fn().mockImplementation((element: HTMLElement) => {
        if (element.id === 'hidden-password') {
          return { display: 'block', visibility: 'hidden', opacity: '1' };
        }
        return { display: 'block', visibility: 'visible', opacity: '1' };
      });

      setGlobalWindow(window);

      detector = new LoginDetector(document);
      detector.initialize();

      const callback = vi.fn();
      detector.onLoginCapture(callback);

      const form = document.querySelector('form');
      form?.dispatchEvent(new window.Event('submit', { bubbles: true }));

      vi.runAllTimers();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].password).toBe('visiblepass');
    });

    it('should skip password fields with opacity:0', () => {
      const { document, window } = createTestEnvironment(`
        <html><body>
          <form>
            <input type="text" id="username" value="testuser">
            <input type="password" id="hidden-password" value="hiddenpass">
            <input type="password" id="visible-password" value="visiblepass">
          </form>
        </body></html>
      `);

      window.getComputedStyle = vi.fn().mockImplementation((element: HTMLElement) => {
        if (element.id === 'hidden-password') {
          return { display: 'block', visibility: 'visible', opacity: '0' };
        }
        return { display: 'block', visibility: 'visible', opacity: '1' };
      });

      setGlobalWindow(window);

      detector = new LoginDetector(document);
      detector.initialize();

      const callback = vi.fn();
      detector.onLoginCapture(callback);

      const form = document.querySelector('form');
      form?.dispatchEvent(new window.Event('submit', { bubbles: true }));

      vi.runAllTimers();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].password).toBe('visiblepass');
    });
  });
});
