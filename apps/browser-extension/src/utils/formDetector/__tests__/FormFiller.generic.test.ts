import { JSDOM } from 'jsdom';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { Credential } from '@/utils/dist/core/models/vault';

import { FormFiller } from '../FormFiller';
import { FormFields } from '../types/FormFields';

import { setupTestDOM, createMockFormFields, createMockCredential, wasTriggerCalledFor, createDateSelects } from './TestUtils';

const { window } = new JSDOM('<!DOCTYPE html>');
global.HTMLSelectElement = window.HTMLSelectElement;
global.HTMLInputElement = window.HTMLInputElement;

describe('FormFiller', () => {
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

  describe('fillBasicFields', () => {
    it('should fill username', async () => {
      await formFiller.fillFields(mockCredential);

      expect(formFields.usernameField?.value).toBe('testuser');
      expect(wasTriggerCalledFor(mockTriggerInputEvents, formFields.usernameField)).toBe(true);
    });

    it('should fill email and confirmation fields', async () => {
      formFields.emailConfirmField = document.createElement('input');

      await formFiller.fillFields(mockCredential);

      expect(formFields.emailField?.value).toBe('test@example.com');
      expect(formFields.emailConfirmField?.value).toBe('test@example.com');
      expect(wasTriggerCalledFor(mockTriggerInputEvents, formFields.emailField)).toBe(true);
      expect(wasTriggerCalledFor(mockTriggerInputEvents, formFields.emailConfirmField)).toBe(true);
    });

    it('should use username as email when no email is provided and no username field exists', async () => {
      // Create a credential with an empty email string
      const credentialWithoutEmail = { ...mockCredential, Alias: { ...mockCredential.Alias, Email: '' } };
      formFields.usernameField = null;

      await formFiller.fillFields(credentialWithoutEmail);

      expect(formFields.emailField?.value).toBe('testuser');
      expect(wasTriggerCalledFor(mockTriggerInputEvents, formFields.emailField)).toBe(true);
    });

    it('should fill password and confirmation fields', async () => {
      formFields.passwordConfirmField = document.createElement('input');

      await formFiller.fillFields(mockCredential);

      // Delay for 150ms to ensure the password field is filled as it uses a small delay between each character.
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(formFields.passwordField?.value).toBe('testpass');
      expect(formFields.passwordConfirmField?.value).toBe('testpass');
      expect(wasTriggerCalledFor(mockTriggerInputEvents, formFields.passwordField)).toBe(true);
      expect(wasTriggerCalledFor(mockTriggerInputEvents, formFields.passwordConfirmField)).toBe(true);
    });

    it('should fill name fields correctly', async () => {
      await formFiller.fillFields(mockCredential);

      expect(formFields.fullNameField?.value).toBe('John Doe');
      expect(formFields.firstNameField?.value).toBe('John');
      expect(formFields.lastNameField?.value).toBe('Doe');
      expect(wasTriggerCalledFor(mockTriggerInputEvents, formFields.fullNameField)).toBe(true);
      expect(wasTriggerCalledFor(mockTriggerInputEvents, formFields.firstNameField)).toBe(true);
      expect(wasTriggerCalledFor(mockTriggerInputEvents, formFields.lastNameField)).toBe(true);
    });
  });

  describe('fillBirthdateFields', () => {
    it('should fill single birthdate field with correct format', async () => {
      await formFiller.fillFields(mockCredential);

      expect(formFields.birthdateField.single?.value).toBe('1991-02-03');
      expect(wasTriggerCalledFor(mockTriggerInputEvents, formFields.birthdateField.single)).toBe(true);
    });

    it('should handle different date formats (mm/dd/yyyy)', async () => {
      formFields.birthdateField.format = 'mm/dd/yyyy';
      await formFiller.fillFields(mockCredential);
      expect(formFields.birthdateField.single?.value).toBe('02/03/1991');
    });

    it('should handle different date formats (dd/mm/yyyy)', async () => {
      formFields.birthdateField.format = 'dd/mm/yyyy';
      await formFiller.fillFields(mockCredential);
      expect(formFields.birthdateField.single?.value).toBe('03/02/1991');
    });

    it('should handle different date formats (dd-mm-yyyy)', async () => {
      formFields.birthdateField.format = 'dd-mm-yyyy';
      await formFiller.fillFields(mockCredential);
      expect(formFields.birthdateField.single?.value).toBe('03-02-1991');
    });

    it('should handle different date formats (mm-dd-yyyy)', async () => {
      formFields.birthdateField.format = 'mm-dd-yyyy';
      await formFiller.fillFields(mockCredential);
      expect(formFields.birthdateField.single?.value).toBe('02-03-1991');
    });

    it('should fill separate day/month/year select fields', async () => {
      const { daySelect, monthSelect, yearSelect } = createDateSelects(document);

      // Add month options (1-12)
      for (let i = 1; i <= 12; i++) {
        const option = document.createElement('option');
        const value = i.toString().padStart(2, '0');
        option.value = value;
        option.text = value;
        monthSelect.appendChild(option);
      }

      formFields.birthdateField = {
        single: null,
        format: 'dd/mm/yyyy',
        day: daySelect as unknown as HTMLInputElement,
        month: monthSelect as unknown as HTMLInputElement,
        year: yearSelect as unknown as HTMLInputElement
      };

      await formFiller.fillFields(mockCredential);

      expect(daySelect.value).toBe('03');
      expect(monthSelect.value).toBe('02');
      expect(yearSelect.value).toBe('1991');
      expect(wasTriggerCalledFor(mockTriggerInputEvents, daySelect)).toBe(true);
      expect(wasTriggerCalledFor(mockTriggerInputEvents, monthSelect)).toBe(true);
      expect(wasTriggerCalledFor(mockTriggerInputEvents, yearSelect)).toBe(true);
    });
  });

  describe('fillGenderFields', () => {
    it('should fill gender select field', async () => {
      const selectElement = document.createElement('select');

      // Add options using createElement
      const maleOption = document.createElement('option');
      maleOption.value = 'm';
      maleOption.text = 'Male';
      selectElement.add(maleOption);

      const femaleOption = document.createElement('option');
      femaleOption.value = 'f';
      femaleOption.text = 'Female';
      selectElement.add(femaleOption);

      formFields.genderField = {
        type: 'select',
        field: selectElement
      };

      await formFiller.fillFields(mockCredential);

      expect(selectElement.value).toBe('m');
      expect(wasTriggerCalledFor(mockTriggerInputEvents, selectElement)).toBe(true);
    });

    it('should handle radio button gender fields', async () => {
      const maleRadio = document.createElement('input');
      maleRadio.type = 'radio';
      const femaleRadio = document.createElement('input');
      femaleRadio.type = 'radio';

      formFields.genderField = {
        type: 'radio',
        field: null,
        radioButtons: {
          male: maleRadio,
          female: femaleRadio,
          other: null
        }
      };

      await formFiller.fillFields(mockCredential);

      expect(maleRadio.checked).toBe(true);
      expect(femaleRadio.checked).toBe(false);
      expect(wasTriggerCalledFor(mockTriggerInputEvents, maleRadio)).toBe(true);
    });
  });
});