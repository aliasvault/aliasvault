import { JSDOM } from 'jsdom';
import { describe, it, expect } from 'vitest';

import { isAvAutofillAllowed, isAvSuppressSave } from '../Autofill';

/**
 * Build a JSDOM environment from the given HTML and return its first <input>.
 */
const buildInput = (html: string): { input: HTMLInputElement; window: Window } => {
  const dom = new JSDOM(html);
  const input = dom.window.document.querySelector('input');
  if (!input) {
    throw new Error('Test fixture must contain an <input> element');
  }
  return { input: input as HTMLInputElement, window: dom.window as unknown as Window };
};

describe('isAvAutofillAllowed', () => {
  it('returns true when no markers are present anywhere', () => {
    const { input } = buildInput('<html><body><form><input></form></body></html>');
    expect(isAvAutofillAllowed(input)).toBe(true);
  });

  it('returns false when av-disable="true" is set on body', () => {
    const { input } = buildInput('<html><body av-disable="true"><form><input></form></body></html>');
    expect(isAvAutofillAllowed(input)).toBe(false);
  });

  it('returns false when av-disable="true" is set on the html element', () => {
    const { input } = buildInput('<html av-disable="true"><body><form><input></form></body></html>');
    expect(isAvAutofillAllowed(input)).toBe(false);
  });

  it('returns true when a closer av-enable="true" overrides av-disable on body', () => {
    const { input } = buildInput(
      '<html><body av-disable="true"><div av-enable="true"><form><input></form></div></body></html>'
    );
    expect(isAvAutofillAllowed(input)).toBe(true);
  });

  it('returns true when av-enable="true" sits on the form itself', () => {
    const { input } = buildInput(
      '<html><body av-disable="true"><form av-enable="true"><input></form></body></html>'
    );
    expect(isAvAutofillAllowed(input)).toBe(true);
  });

  it('returns true when av-enable="true" sits directly on the input', () => {
    const { input } = buildInput(
      '<html><body av-disable="true"><form><input av-enable="true"></form></body></html>'
    );
    expect(isAvAutofillAllowed(input)).toBe(true);
  });

  it('returns false when a closer av-disable="true" overrides av-enable higher up', () => {
    const { input } = buildInput(
      '<html><body av-enable="true"><div av-disable="true"><form><input></form></div></body></html>'
    );
    expect(isAvAutofillAllowed(input)).toBe(false);
  });

  it('ignores non-"true" values (treats av-disable="false" as absent)', () => {
    const { input } = buildInput('<html><body av-disable="false"><form><input></form></body></html>');
    expect(isAvAutofillAllowed(input)).toBe(true);
  });

  it('returns true for a null element', () => {
    expect(isAvAutofillAllowed(null)).toBe(true);
  });
});

describe('isAvSuppressSave', () => {
  it('returns false when no markers are present', () => {
    const { input } = buildInput('<html><body><form><input></form></body></html>');
    expect(isAvSuppressSave(input)).toBe(false);
  });

  it('returns true when av-suppress-save="true" is on an ancestor', () => {
    const { input } = buildInput(
      '<html><body><form av-suppress-save="true"><input></form></body></html>'
    );
    expect(isAvSuppressSave(input)).toBe(true);
  });

  it('returns true when av-suppress-save="true" is on the element itself', () => {
    const { input } = buildInput('<html><body><form><input av-suppress-save="true"></form></body></html>');
    expect(isAvSuppressSave(input)).toBe(true);
  });

  it('returns false when a closer av-suppress-save="false" overrides a "true" higher up', () => {
    const { input } = buildInput(
      '<html><body av-suppress-save="true"><div av-suppress-save="false"><form><input></form></div></body></html>'
    );
    expect(isAvSuppressSave(input)).toBe(false);
  });

  it('ignores non-"true"/"false" values (treats av-suppress-save="" as absent)', () => {
    const { input } = buildInput('<html><body av-suppress-save=""><form><input></form></body></html>');
    expect(isAvSuppressSave(input)).toBe(false);
  });

  it('returns false for a null element', () => {
    expect(isAvSuppressSave(null)).toBe(false);
  });
});
