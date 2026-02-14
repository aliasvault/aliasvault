import { describe, it, expect, afterEach, vi } from 'vitest';

import { LoginDetector } from '../LoginDetector';

import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setGlobalWindow,
  setGlobalHTMLElements,
  MockMutationObserver,
} from './TestUtils';

import type { CapturedLogin } from '../types';

describe('LoginDetector button click capture', () => {
  let detector: LoginDetector;

  afterEach(() => {
    if (detector) {
      detector.destroy();
    }
    cleanupTestEnvironment();
  });

  describe('submit button click', () => {
    it('should capture login when submit button is clicked (AJAX-style)', () => {
      const { document, window } = createTestEnvironment(`
        <html><body>
          <form id="login-form">
            <input type="email" id="email" name="email" value="user@example.com">
            <input type="password" id="password" name="password" value="testpass123">
            <button type="submit" id="submit-btn">Login</button>
          </form>
        </body></html>
      `);
      setGlobalWindow(window);

      detector = new LoginDetector(document);
      detector.initialize();

      const callback = vi.fn();
      detector.onLoginCapture(callback);

      // Simulate button click (like AJAX login would do)
      const button = document.getElementById('submit-btn');
      button?.dispatchEvent(new window.Event('click', { bubbles: true }));

      vi.runAllTimers();

      expect(callback).toHaveBeenCalledTimes(1);

      const capturedLogin: CapturedLogin = callback.mock.calls[0][0];
      expect(capturedLogin.username).toBe('user@example.com');
      expect(capturedLogin.password).toBe('testpass123');
      expect(capturedLogin.domain).toBe('example.com');
    });

    it('should capture login when button without type attribute is clicked', () => {
      const { document, window } = createTestEnvironment(`
        <html><body>
          <form id="login-form">
            <input type="text" id="username" name="username" value="testuser">
            <input type="password" id="password" name="password" value="mypassword">
            <button id="login-btn">Sign In</button>
          </form>
        </body></html>
      `);
      setGlobalWindow(window);

      detector = new LoginDetector(document);
      detector.initialize();

      const callback = vi.fn();
      detector.onLoginCapture(callback);

      const button = document.getElementById('login-btn');
      button?.dispatchEvent(new window.Event('click', { bubbles: true }));

      vi.runAllTimers();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].username).toBe('testuser');
      expect(callback.mock.calls[0][0].password).toBe('mypassword');
    });

    it('should capture login when input[type=submit] is clicked', () => {
      const { document, window } = createTestEnvironment(`
        <html><body>
          <form id="login-form">
            <input type="email" id="email" name="email" value="test@test.com">
            <input type="password" id="password" name="password" value="secret123">
            <input type="submit" id="submit-input" value="Log In">
          </form>
        </body></html>
      `);
      setGlobalWindow(window);

      detector = new LoginDetector(document);
      detector.initialize();

      const callback = vi.fn();
      detector.onLoginCapture(callback);

      const submitInput = document.getElementById('submit-input');
      submitInput?.dispatchEvent(new window.Event('click', { bubbles: true }));

      vi.runAllTimers();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].username).toBe('test@test.com');
      expect(callback.mock.calls[0][0].password).toBe('secret123');
    });

    it('should not capture when button type is "button" (non-submit)', () => {
      const { document, window } = createTestEnvironment(`
        <html><body>
          <form id="login-form">
            <input type="text" id="username" name="username" value="testuser">
            <input type="password" id="password" name="password" value="testpass">
            <button type="button" id="cancel-btn">Cancel</button>
            <button type="submit" id="submit-btn">Login</button>
          </form>
        </body></html>
      `);
      setGlobalWindow(window);

      detector = new LoginDetector(document);
      detector.initialize();

      const callback = vi.fn();
      detector.onLoginCapture(callback);

      // Click the cancel button (type="button")
      const cancelButton = document.getElementById('cancel-btn');
      cancelButton?.dispatchEvent(new window.Event('click', { bubbles: true }));

      vi.runAllTimers();

      // Should not have captured from cancel button
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('deduplication', () => {
    it('should deduplicate when both button click and form submit fire', () => {
      const { document, window } = createTestEnvironment(`
        <html><body>
          <form id="login-form">
            <input type="text" id="username" name="username" value="testuser">
            <input type="password" id="password" name="password" value="testpass123">
            <button type="submit" id="submit-btn">Login</button>
          </form>
        </body></html>
      `);
      setGlobalWindow(window);

      detector = new LoginDetector(document);
      detector.initialize();

      const callback = vi.fn();
      detector.onLoginCapture(callback);

      const form = document.querySelector('form');
      const button = document.getElementById('submit-btn');

      // Simulate real scenario: click fires first, then submit
      button?.dispatchEvent(new window.Event('click', { bubbles: true }));
      form?.dispatchEvent(new window.Event('submit', { bubbles: true }));

      vi.runAllTimers();

      // Should only capture once due to debouncing
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('dynamically added buttons', () => {
    it('should capture from dynamically added submit button', () => {
      const { document, window } = createTestEnvironment(`
        <html><body>
          <form id="login-form">
            <input type="email" id="email" name="email" value="dynamic@example.com">
            <input type="password" id="password" name="password" value="dynamicpass">
          </form>
        </body></html>
      `);

      setGlobalHTMLElements(window);
      setGlobalWindow(window);

      detector = new LoginDetector(document);
      detector.initialize();

      const callback = vi.fn();
      detector.onLoginCapture(callback);

      // Dynamically add a submit button
      const form = document.getElementById('login-form') as HTMLFormElement;
      const button = document.createElement('button');
      button.type = 'submit';
      button.id = 'dynamic-submit';
      button.textContent = 'Submit';
      form?.appendChild(button);

      // Trigger MutationObserver manually with the new button
      const observer = (document.body as unknown as { __mutationObserver: MockMutationObserver }).__mutationObserver;
      if (observer) {
        observer.trigger([{
          type: 'childList',
          addedNodes: [button] as unknown as NodeList,
          removedNodes: [] as unknown as NodeList,
          target: form,
          previousSibling: null,
          nextSibling: null,
          attributeName: null,
          attributeNamespace: null,
          oldValue: null,
        }]);
      }

      vi.runAllTimers();

      // Click the dynamically added button
      button.dispatchEvent(new window.Event('click', { bubbles: true }));

      vi.runAllTimers();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].username).toBe('dynamic@example.com');
    });
  });

  describe('role="button" elements', () => {
    it('should capture login when element with role="button" is clicked', () => {
      const { document, window } = createTestEnvironment(`
        <html><body>
          <form id="login-form">
            <input type="text" id="username" name="username" value="roleuser">
            <input type="password" id="password" name="password" value="rolepass">
            <div role="button" id="custom-btn">Login</div>
          </form>
        </body></html>
      `);
      setGlobalWindow(window);

      detector = new LoginDetector(document);
      detector.initialize();

      const callback = vi.fn();
      detector.onLoginCapture(callback);

      const button = document.getElementById('custom-btn');
      button?.dispatchEvent(new window.Event('click', { bubbles: true }));

      vi.runAllTimers();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].username).toBe('roleuser');
      expect(callback.mock.calls[0][0].password).toBe('rolepass');
    });
  });
});
