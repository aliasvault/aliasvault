import { describe, it, expect, afterEach, vi } from 'vitest';

import { LoginDetector } from '../LoginDetector';

import { createTestEnvironment, cleanupTestEnvironment, setGlobalWindow } from './TestUtils';

describe('LoginDetector av-disable attribute', () => {
  let detector: LoginDetector;

  afterEach(() => {
    if (detector) {
      detector.destroy();
    }
    cleanupTestEnvironment();
  });

  it('should skip when av-disable="true" is set on body', () => {
    const { document, window } = createTestEnvironment(
      `<html><body av-disable="true">
        <form>
          <input type="text" value="user">
          <input type="password" value="pass">
        </form>
      </body></html>`
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

  it('should skip when av-disable="true" is set on html element', () => {
    const { document, window } = createTestEnvironment(
      `<html av-disable="true"><body>
        <form>
          <input type="text" value="user">
          <input type="password" value="pass">
        </form>
      </body></html>`
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

  it('should not skip when av-disable is not set', () => {
    const { document, window } = createTestEnvironment(
      `<html><body>
        <form>
          <input type="text" value="user">
          <input type="password" value="pass">
        </form>
      </body></html>`
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

  it('should not skip when av-disable="false"', () => {
    const { document, window } = createTestEnvironment(
      `<html><body av-disable="false">
        <form>
          <input type="text" value="user">
          <input type="password" value="pass">
        </form>
      </body></html>`
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

describe('LoginDetector av-enable attribute', () => {
  let detector: LoginDetector;

  afterEach(() => {
    if (detector) {
      detector.destroy();
    }
    cleanupTestEnvironment();
  });

  it('should capture when av-enable="true" overrides av-disable on body', () => {
    const { document, window } = createTestEnvironment(
      `<html><body av-disable="true">
        <div av-enable="true">
          <form>
            <input type="text" value="user">
            <input type="password" value="pass">
          </form>
        </div>
      </body></html>`
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

  it('should capture when av-enable="true" is set directly on the form', () => {
    const { document, window } = createTestEnvironment(
      `<html><body av-disable="true">
        <form av-enable="true">
          <input type="text" value="user">
          <input type="password" value="pass">
        </form>
      </body></html>`
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

  it('should skip a form that is opted in via av-enable but also marked av-suppress-save', () => {
    const { document, window } = createTestEnvironment(
      `<html><body av-disable="true">
        <form av-enable="true" av-suppress-save="true">
          <input type="text" value="user">
          <input type="password" value="pass">
        </form>
      </body></html>`
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

  it('should still skip sibling forms when av-enable is scoped elsewhere', () => {
    const { document, window } = createTestEnvironment(
      `<html><body av-disable="true">
        <div av-enable="true">
          <form id="opted-in">
            <input type="text" value="alice">
            <input type="password" value="pw1">
          </form>
        </div>
        <form id="still-disabled">
          <input type="text" value="bob">
          <input type="password" value="pw2">
        </form>
      </body></html>`
    );
    setGlobalWindow(window);

    detector = new LoginDetector(document);
    detector.initialize();

    const callback = vi.fn();
    detector.onLoginCapture(callback);

    document.getElementById('still-disabled')?.dispatchEvent(new window.Event('submit', { bubbles: true }));
    vi.runAllTimers();
    expect(callback).not.toHaveBeenCalled();

    document.getElementById('opted-in')?.dispatchEvent(new window.Event('submit', { bubbles: true }));
    vi.runAllTimers();
    expect(callback).toHaveBeenCalled();
  });
});
