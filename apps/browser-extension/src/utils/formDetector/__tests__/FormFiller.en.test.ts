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

describe('FormFiller English', () => {
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

  describe('fillBirthdateFields with English month names', () => {
    it('should fill separate fields with English month names', async () => {
      const { daySelect, monthSelect, yearSelect } = createDateSelects(document);

      // Add month options with English month names
      const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
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
      expect(monthSelect.value).toBe('February');
      expect(yearSelect.value).toBe('1991');
      expect(wasTriggerCalledFor(mockTriggerInputEvents, daySelect)).toBe(true);
      expect(wasTriggerCalledFor(mockTriggerInputEvents, monthSelect)).toBe(true);
      expect(wasTriggerCalledFor(mockTriggerInputEvents, yearSelect)).toBe(true);
    });
  });

  describe('French login form 1 (France Tax Authority)', () => {
    it('should detect and fill username field with autocomplete="username" and name="spi_tmp"', async () => {
      const dom = createTestDom('fr-login-form1.html');
      const doc = dom.window.document;

      // Get the input field
      const usernameInput = doc.getElementById('spi_tmp') as HTMLInputElement;
      expect(usernameInput).not.toBeNull();

      // Create form detector to find the form fields
      const formDetector = new FormDetector(doc, usernameInput);
      const detectedFields = formDetector.getForm();

      // The username field should be detected due to autocomplete="username"
      expect(detectedFields?.usernameField).toBe(usernameInput);

      // If the field is detected, test filling it
      if (detectedFields) {
        const triggerMock = vi.fn();
        const filler = new FormFiller(detectedFields, triggerMock);
        await filler.fillFields(mockCredential);

        expect(usernameInput.value).toBe('testuser');
        expect(wasTriggerCalledFor(triggerMock, usernameInput)).toBe(true);
      }
    });
  });
});