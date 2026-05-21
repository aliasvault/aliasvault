import { describe, expect, it } from 'vitest';

import { FormDetector } from '../FormDetector';

import { FormField, testField, createTestDom } from './TestUtils';

describe('FormDetector German tests', () => {
  it('contains tests for German form field detection', () => {
    expect(true).toBe(true);
  });

  describe('German login form 1 detection (o2 business / Salesforce Lightning)', () => {
    const htmlFile = 'de-login-form1.html';

    /*
     * The visible label "Benutzername:" sits at the wrapper level with
     * for="username" while the actual input id is "input-17". The label that
     * does match (for="input-17") is nested deeper but contains only empty
     * <slot> elements. Detection must look past the empty nested label to
     * the visible outer one.
     */
    testField(FormField.Username, 'input-17', htmlFile);
    testField(FormField.Password, 'input-18', htmlFile);

    it('should detect the form as a login form', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;
      const formDetector = new FormDetector(document);
      expect(formDetector.containsLoginForm()).toBe(true);
    });
  });
});
