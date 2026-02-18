import { readFileSync } from 'fs';
import { join } from 'path';

import { JSDOM, DOMWindow } from 'jsdom';
import { it, expect, vi } from 'vitest';

import { Gender } from '@/utils/dist/core/identity-generator';
import type { Credential } from '@/utils/dist/core/models/vault';
import { FormDetector } from '@/utils/formDetector/FormDetector';
import { FormFields } from '@/utils/formDetector/types/FormFields';

export enum FormField {
  Username = 'username',
  FirstName = 'firstName',
  LastName = 'lastName',
  FullName = 'fullName',
  Email = 'email',
  EmailConfirm = 'emailConfirm',
  Password = 'password',
  PasswordConfirm = 'passwordConfirm',
  BirthDate = 'birthdate',
  BirthDateFormat = 'birthdateFormat',
  BirthDay = 'birthdateDay',
  BirthMonth = 'birthdateMonth',
  BirthYear = 'birthdateYear',
  Gender = 'gender',
  GenderMale = 'genderMale',
  GenderFemale = 'genderFemale',
  GenderOther = 'genderOther',
  Totp = 'totp'
}

/**
 * Create a JSDOM instance for a test HTML file that can be used to provide as
 * input to the form detector logic.
 */
export const createTestDom = (htmlFile: string) : JSDOM => {
  const html = loadTestHtml(htmlFile);
  return new JSDOM(html, {
    url: 'http://localhost',
    runScripts: 'dangerously',
    resources: 'usable'
  });
};

/**
 * Creates a test document with the specified title and URL.
 * This is used for testing service name extraction.
 */
export const createTestDocument = (title: string, url: string) : { document: Document, location: Location } => {
  const dom = createTestDom('empty.html');
  const document = dom.window.document;

  // Set the title
  document.title = title;

  // Create a proper Location object
  const location = {
    href: url,
    origin: new URL(url).origin,
    protocol: new URL(url).protocol,
    host: new URL(url).host,
    hostname: new URL(url).hostname,
    port: new URL(url).port,
    pathname: new URL(url).pathname,
    search: new URL(url).search,
    hash: new URL(url).hash,
    ancestorOrigins: {} as DOMStringList,
  } as Location;

  return { document, location };
};

/**
 * Helper function to test field detection
 */
export const testField = (fieldName: FormField, elementId: string, htmlFile: string) : void => {
  it(`should detect ${fieldName} field`, () => {
    const { document, result } = setupFormTest(htmlFile, elementId);

    // First verify the test element exists
    const expectedElement = document.getElementById(elementId);
    if (!expectedElement) {
      throw new Error(`Test setup failed: Element with id "${elementId}" not found in test HTML. Check if the element is present in the test HTML file: ${htmlFile}`);
    }

    // Handle birthdate fields differently
    if (fieldName === FormField.BirthDate) {
      expect(result?.birthdateField.single).toBe(expectedElement);
    } else if (fieldName === FormField.BirthDay) {
      expect(result?.birthdateField.day).toBe(expectedElement);
    } else if (fieldName === FormField.BirthMonth) {
      expect(result?.birthdateField.month).toBe(expectedElement);
    } else if (fieldName === FormField.BirthYear) {
      expect(result?.birthdateField.year).toBe(expectedElement);
    // Handle gender field differently
    } else if (fieldName === FormField.Gender) {
      expect(result?.genderField.field).toBe(expectedElement);
    } else if (fieldName === FormField.GenderMale) {
      expect(result?.genderField.radioButtons?.male).toBe(expectedElement);
    } else if (fieldName === FormField.GenderFemale) {
      expect(result?.genderField.radioButtons?.female).toBe(expectedElement);
    } else if (fieldName === FormField.GenderOther) {
      expect(result?.genderField.radioButtons?.other).toBe(expectedElement);
    // Handle default fields
    } else {
      const fieldKey = `${fieldName}Field` as keyof typeof result;
      expect(result?.[fieldKey]).toBeDefined();
      expect(result?.[fieldKey]).toBe(expectedElement);
    }
  });
};

/**
 * Test the birthdate format.
 */
export const testBirthdateFormat = (expectedFormat: string, htmlFile: string, focusedElementId: string) : void => {
  it('should detect correct birthdate format', () => {
    const { result } = setupFormTest(htmlFile, focusedElementId);
    expect(result?.birthdateField.format).toBe(expectedFormat);
  });
};

/**
 * Load a test HTML file.
 */
const loadTestHtml = (filename: string): string => {
  return readFileSync(join(__dirname, 'test-forms', filename), 'utf-8');
};

/**
 * Set up a form detection test.
 */
const setupFormTest = (htmlFile: string, focusedElementId: string) : { document: Document, result: FormFields | null } => {
  const html = loadTestHtml(htmlFile);
  const dom = new JSDOM(html, {
    url: 'http://localhost',
    runScripts: 'dangerously',
    resources: 'usable'
  });
  const document = dom.window.document;

  // Set focus on specified element if provided
  let focusedElement = document.getElementById(focusedElementId);
  if (!focusedElement) {
    throw new Error(`Focus element with id "${focusedElementId}" not found in test HTML`);
  }

  // Create a new form detector with the focused element.
  const formDetector = new FormDetector(document, focusedElement);
  const result = formDetector.getForm();
  return { document, result };
};

/**
 * Setup a test DOM to be used in unit test context.
 */
export const setupTestDOM = () : { window: DOMWindow, document: Document } => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
    storageQuota: 10000000
  });
  const window = dom.window;
  const document = window.document;

  // Mock localStorage
  const localStorageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    clear: vi.fn(),
    removeItem: vi.fn(),
    length: 0,
    key: vi.fn(),
  };
  Object.defineProperty(window, 'localStorage', { value: localStorageMock });

  return { window, document };
};

/**
 * Create a mock form fields object with dummy form element instances.
 */
export const createMockFormFields = (document: Document): FormFields => ({
  form: document.createElement('form'),
  usernameField: document.createElement('input'),
  passwordField: document.createElement('input'),
  passwordConfirmField: document.createElement('input'),
  emailField: document.createElement('input'),
  emailConfirmField: document.createElement('input'),
  fullNameField: document.createElement('input'),
  firstNameField: document.createElement('input'),
  lastNameField: document.createElement('input'),
  birthdateField: {
    single: document.createElement('input'),
    format: 'yyyy-mm-dd',
    day: null,
    month: null,
    year: null
  },
  genderField: {
    type: 'select',
    field: document.createElement('select')
  },
  totpField: null
});

/**
 * Create a mock credential object with dummy values.
 */
export const createMockCredential = (): Credential => ({
  Id: '123',
  Username: 'testuser',
  Password: 'testpass',
  ServiceName: 'Test Service',
  Alias: {
    FirstName: 'John',
    LastName: 'Doe',
    BirthDate: '1991-02-03',
    Gender: Gender.Male,
    Email: 'test@example.com',
  }
});

/**
 * Create date select elements.
 */
export const createDateSelects = (document: Document) : { daySelect: HTMLSelectElement, monthSelect: HTMLSelectElement, yearSelect: HTMLSelectElement } => {
  const daySelect = document.createElement('select');
  const monthSelect = document.createElement('select');
  const yearSelect = document.createElement('select');

  // Add day options (1-31)
  for (let i = 1; i <= 31; i++) {
    const option = document.createElement('option');
    const value = i.toString().padStart(2, '0');
    option.value = value;
    option.text = value;
    daySelect.appendChild(option);
  }

  // Add year options (1900-2024)
  for (let i = 1900; i <= 2024; i++) {
    const option = document.createElement('option');
    option.value = i.toString();
    option.text = i.toString();
    yearSelect.appendChild(option);
  }

  return { daySelect, monthSelect, yearSelect };
};

/**
 * Check if the trigger input event was called for a specific field.
 */
export const wasTriggerCalledFor = (mockTriggerInputEvents: ReturnType<typeof vi.fn>, field: HTMLElement | null): boolean => {
  if (!field) {
    return false;
  }
  return mockTriggerInputEvents.mock.calls.some(call => call[0] === field);
};
