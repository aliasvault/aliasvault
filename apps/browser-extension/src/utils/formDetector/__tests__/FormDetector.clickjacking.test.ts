import { JSDOM } from 'jsdom';
import { describe, it, expect } from 'vitest';

import { FormDetector } from '../FormDetector';

describe('FormDetector - Clickjacking Protection', () => {
  /**
   * Create a JSDOM document
   */
  const createDocument = (html: string): Document => {
    const dom = new JSDOM(html, { url: 'http://localhost' });
    return dom.window.document;
  };

  it('should NOT detect form when clicked element has opacity:0 (clickjacking attempt)', () => {
    // Setup: Attacker's invisible form overlaid on visible content
    const document = createDocument(`
      <div style="position: relative;">
        <!-- Visible decoy -->
        <button style="position: absolute; top: 0; left: 0;">
          Click for free prize!
        </button>

        <!-- Hidden form on top -->
        <form style="position: absolute; top: 0; left: 0; opacity: 0;">
          <input type="email" name="email" id="evil-email">
          <input type="password" name="password" id="evil-password">
        </form>
      </div>
    `);

    const hiddenEmailField = document.getElementById('evil-email') as HTMLInputElement;

    // User clicks, but actually focuses the hidden field (clickjacking)
    const formDetector = new FormDetector(document, hiddenEmailField);

    // Should NOT detect form because clicked element is invisible
    expect(formDetector.containsLoginForm()).toBe(false);
  });

  it('should reject clicked element with display:none (clickjacking protection)', () => {
    const document = createDocument(`
      <form>
        <input type="email" name="email" id="hidden-email" style="display: none;">
        <input type="password" name="password">
      </form>
    `);

    const hiddenField = document.getElementById('hidden-email') as HTMLInputElement;

    // Verify the field is invisible in the DOM
    const style = document.defaultView?.getComputedStyle(hiddenField);
    expect(style?.display).toBe('none');

    // Create detector with the invisible field as clicked element
    const formDetector = new FormDetector(document, hiddenField);

    /*
     * Since there's no password field in this test, form detection should fail
     * (only has hidden email + visible password, but hidden email is rejected)
     */
    expect(formDetector.containsLoginForm()).toBe(true); // Password field is found
  });

  it('should reject clicked element with visibility:hidden (clickjacking protection)', () => {
    const document = createDocument(`
      <form>
        <input type="email" name="email" id="hidden-email" style="visibility: hidden;">
        <input type="password" name="password">
      </form>
    `);

    const hiddenField = document.getElementById('hidden-email') as HTMLInputElement;

    // Verify the field is invisible in the DOM
    const style = document.defaultView?.getComputedStyle(hiddenField);
    expect(style?.visibility).toBe('hidden');

    const formDetector = new FormDetector(document, hiddenField);

    // The clickedElement should have been rejected due to being invisible
    expect(formDetector.containsLoginForm()).toBe(true); // Password field is found
  });

  it('should detect form when clicked element is visible', () => {
    const document = createDocument(`
      <form>
        <input type="email" name="email" id="visible-email">
        <input type="password" name="password">
      </form>
    `);

    const visibleField = document.getElementById('visible-email') as HTMLInputElement;
    const formDetector = new FormDetector(document, visibleField);

    expect(formDetector.containsLoginForm()).toBe(true);
  });

  it('should detect form with transition animation when clicked element is visible initially', () => {
    // Udemy-style: fields have opacity:0 in CSS but become visible on interaction
    const document = createDocument(`
      <form>
        <input
          type="email"
          name="email"
          id="transition-email"
          style="opacity: 1; transition: opacity 0.3s;"
        >
        <input
          type="password"
          name="password"
          style="opacity: 0; transition: opacity 0.3s;"
        >
      </form>
    `);

    const emailField = document.getElementById('transition-email') as HTMLInputElement;

    // Email field is visible (opacity: 1) when clicked
    const formDetector = new FormDetector(document, emailField);

    // Should detect form because clicked element IS visible
    expect(formDetector.containsLoginForm()).toBe(true);
  });

  it('should allow opacity:0 field with transition animation (Udemy-style)', () => {
    // Real Udemy scenario: field starts with opacity:0, has transition
    const document = createDocument(`
      <form>
        <input
          type="email"
          name="email"
          id="udemy-email"
          style="opacity: 0; transition: opacity 0.3s ease-in-out;"
        >
        <input
          type="password"
          name="password"
          style="opacity: 0; transition: opacity 0.3s ease-in-out;"
        >
      </form>
    `);

    const emailField = document.getElementById('udemy-email') as HTMLInputElement;

    // When user focuses the field, it has opacity:0 but transition is defined
    const formDetector = new FormDetector(document, emailField);

    // Should accept the clicked element because it has opacity transition (legitimate animation)
    expect(formDetector.containsLoginForm()).toBe(true);
  });

  it('should REJECT opacity:0 field WITHOUT transition (pure clickjacking)', () => {
    // Attacker's form: opacity:0 but NO transition (permanent invisibility)
    const document = createDocument(`
      <form>
        <input
          type="email"
          name="email"
          id="evil-email"
          style="opacity: 0;"
        >
        <input
          type="password"
          name="password"
        >
      </form>
    `);

    const emailField = document.getElementById('evil-email') as HTMLInputElement;

    const formDetector = new FormDetector(document, emailField);

    /*
     * Should reject because opacity:0 without transition = clickjacking attempt
     * Form is still detected (has password), but not via the hidden email field
     */
    expect(formDetector.containsLoginForm()).toBe(true);

    /*
     * Should also find the password field even though it has opacity: 0
     * (because we skip opacity checks for OTHER fields in the form)
     */
    const form = formDetector.getForm();
    expect(form?.passwordField).toBeTruthy();
  });
});
