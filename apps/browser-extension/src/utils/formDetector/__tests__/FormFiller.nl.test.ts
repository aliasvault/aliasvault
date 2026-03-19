import { JSDOM } from 'jsdom';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { Credential } from '@/utils/dist/core/models/vault';

import { FormDetector } from '../FormDetector';
import { FormFiller } from '../FormFiller';
import { FormFields } from '../types/FormFields';

import { setupTestDOM, createMockFormFields, createMockCredential, wasTriggerCalledFor, createDateSelects, createTestDom } from './TestUtils';

const { window } = new JSDOM('<!DOCTYPE html>');
global.HTMLSelectElement = window.HTMLSelectElement;
global.HTMLInputElement = window.HTMLInputElement;

describe('FormFiller Dutch', () => {
  let mockTriggerInputEvents: ReturnType<typeof vi.fn>;
  let formFields: FormFields;
  let formFiller: FormFiller;
  let mockCredential: Credential;
  let document: Document;

  beforeEach(() => {
    const { document: doc } = setupTestDOM();
    document = doc;
    mockTriggerInputEvents = vi.fn();
    formFields = createMockFormFields(document);
    mockCredential = createMockCredential();
    formFiller = new FormFiller(formFields, mockTriggerInputEvents);
  });

  describe('fillBirthdateFields with Dutch month names', () => {
    it('should fill separate fields with Dutch month names', async () => {
      const { daySelect, monthSelect, yearSelect } = createDateSelects(document);

      // Add month options with Dutch month names
      const months = [
        'Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni',
        'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December'
      ];
      months.forEach((month, _) => {
        const option = document.createElement('option');
        option.value = month;
        option.text = month;
        monthSelect.appendChild(option);
      });

      formFields.birthdateField = {
        single: null,
        format: 'dd/mm/yyyy',
        day: daySelect as unknown as HTMLInputElement,
        month: monthSelect as unknown as HTMLInputElement,
        year: yearSelect as unknown as HTMLInputElement
      };

      await formFiller.fillFields(mockCredential);

      expect(daySelect.value).toBe('03');
      expect(monthSelect.value).toBe('Februari');
      expect(yearSelect.value).toBe('1991');
      expect(wasTriggerCalledFor(mockTriggerInputEvents, daySelect)).toBe(true);
      expect(wasTriggerCalledFor(mockTriggerInputEvents, monthSelect)).toBe(true);
      expect(wasTriggerCalledFor(mockTriggerInputEvents, yearSelect)).toBe(true);
    });
  });

  describe('Dutch login form 1 field filling', () => {
    const htmlFile = 'nl-login-form1.html';
    let mockCredential: Credential;

    beforeEach(() => {
      mockCredential = createMockCredential();
    });

    it('should fill username field successfully', async () => {
      const dom = createTestDom(htmlFile);
      const doc = dom.window.document;

      const usernameInput = doc.getElementById('login_form_user') as HTMLInputElement;
      const formDetector = new FormDetector(doc, usernameInput);
      const detectedFields = formDetector.getForm();

      expect(detectedFields).not.toBeNull();

      if (detectedFields) {
        const triggerMock = vi.fn();
        const filler = new FormFiller(detectedFields, triggerMock);
        await filler.fillFields(mockCredential);

        expect(usernameInput.value).toBe('testuser');
        expect(wasTriggerCalledFor(triggerMock, usernameInput)).toBe(true);
      }
    });

    it('should fill password field successfully', async () => {
      const dom = createTestDom(htmlFile);
      const doc = dom.window.document;

      const passwordInput = doc.getElementById('login_form_password') as HTMLInputElement;
      const formDetector = new FormDetector(doc, passwordInput);
      const detectedFields = formDetector.getForm();

      expect(detectedFields).not.toBeNull();

      if (detectedFields) {
        const triggerMock = vi.fn();
        const filler = new FormFiller(detectedFields, triggerMock);
        await filler.fillFields(mockCredential);

        await new Promise(resolve => setTimeout(resolve, 150));

        expect(passwordInput.value).toBe('testpass');
        expect(wasTriggerCalledFor(triggerMock, passwordInput)).toBe(true);
      }
    });

    it('should fill both username and password fields without filling other fields', async () => {
      const dom = createTestDom(htmlFile);
      const doc = dom.window.document;

      const usernameInput = doc.getElementById('login_form_user') as HTMLInputElement;
      const passwordInput = doc.getElementById('login_form_password') as HTMLInputElement;
      const sessionNameInput = doc.getElementById('login_form_sessionName') as HTMLInputElement;
      const hiddenLocation = doc.getElementById('login_form_location') as HTMLInputElement;

      const formDetector = new FormDetector(doc, usernameInput);
      const detectedFields = formDetector.getForm();

      expect(detectedFields).not.toBeNull();

      if (detectedFields) {
        const triggerMock = vi.fn();
        const filler = new FormFiller(detectedFields, triggerMock);
        await filler.fillFields(mockCredential);

        await new Promise(resolve => setTimeout(resolve, 150));

        expect(usernameInput.value).toBe('testuser');
        expect(passwordInput.value).toBe('testpass');

        expect(sessionNameInput.value).toBe('');
        expect(hiddenLocation.value).toBe('https://example.com/');

        expect(wasTriggerCalledFor(triggerMock, usernameInput)).toBe(true);
        expect(wasTriggerCalledFor(triggerMock, passwordInput)).toBe(true);
        expect(wasTriggerCalledFor(triggerMock, sessionNameInput)).toBe(false);
        expect(wasTriggerCalledFor(triggerMock, hiddenLocation)).toBe(false);
      }
    });

    it('should handle form with credential containing email', async () => {
      const dom = createTestDom(htmlFile);
      const doc = dom.window.document;

      const usernameInput = doc.getElementById('login_form_user') as HTMLInputElement;
      const formDetector = new FormDetector(doc, usernameInput);
      const detectedFields = formDetector.getForm();

      expect(detectedFields).not.toBeNull();

      if (detectedFields) {
        const triggerMock = vi.fn();
        const filler = new FormFiller(detectedFields, triggerMock);

        await filler.fillFields(mockCredential);

        expect(usernameInput.value).toBe('testuser');
        expect(usernameInput.value).not.toBe('test@example.com');
      }
    });

    it('should only fill the actual username field, not hidden fields that might match patterns', async () => {
      const dom = createTestDom(htmlFile);
      const doc = dom.window.document;

      const usernameInput = doc.getElementById('login_form_user') as HTMLInputElement;
      const formDetector = new FormDetector(doc, usernameInput);
      const detectedFields = formDetector.getForm();

      expect(detectedFields).not.toBeNull();

      if (detectedFields) {
        const triggerMock = vi.fn();
        const filler = new FormFiller(detectedFields, triggerMock);
        await filler.fillFields(createMockCredential());

        const allInputs = Array.from(doc.querySelectorAll('input[type="text"]')) as HTMLInputElement[];
        const filledInputs = allInputs.filter(input => input.value !== '');

        expect(filledInputs.length).toBe(1);
        expect(filledInputs[0]).toBe(usernameInput);
      }
    });
  });
});