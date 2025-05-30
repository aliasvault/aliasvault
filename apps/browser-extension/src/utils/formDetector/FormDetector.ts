import { FormFields } from "./types/FormFields";
import { CombinedFieldPatterns, CombinedGenderOptionPatterns, CombinedStopWords } from "./FieldPatterns";

/**
 * Form detector.
 */
export class FormDetector {
  private readonly document: Document;
  private readonly clickedElement: HTMLElement | null;
  private readonly visibilityCache: Map<HTMLElement, boolean>;

  /**
   * Constructor.
   */
  public constructor(document: Document, clickedElement?: HTMLElement) {
    this.document = document;
    this.clickedElement = clickedElement ?? null;
    this.visibilityCache = new Map();
  }

  /**
   * Detect login forms on the page based on the clicked element.
   */
  public containsLoginForm(): boolean {
    let formWrapper = this.getFormWrapper();
    if (formWrapper?.getAttribute('role') === 'dialog') {
      // If we hit a dialog, search for form only within the dialog
      formWrapper = formWrapper.querySelector('form') as HTMLElement | null ?? formWrapper;
    }

    if (!formWrapper) {
      // If no form or dialog found, fallback to document.body
      formWrapper = this.document.body as HTMLElement;
    }

    /**
     * Sanity check: if form contains more than 150 inputs, don't process as this is likely not a login form.
     * This is a simple way to prevent processing large forms that are not login forms and making the browser page unresponsive.
     */
    const inputCount = formWrapper.querySelectorAll('input').length;
    if (inputCount > 200) {
      return false;
    }

    // Check if the wrapper contains a password or likely username field before processing.
    if (this.containsPasswordField(formWrapper) || this.containsLikelyUsernameOrEmailField(formWrapper)) {
      return true;
    }

    return false;
  }

  /**
   * Detect login forms on the page based on the clicked element.
   */
  public getForm(): FormFields | null {
    if (!this.clickedElement) {
      return null;
    }

    const formWrapper = this.getFormWrapper();
    return this.detectFormFields(formWrapper);
  }

  /**
   * Get suggested service names from the page title and URL.
   * Returns an array with two suggestions: the primary name and the domain name as an alternative.
   */
  public static getSuggestedServiceName(document: Document, location: Location): string[] {
    const title = document.title;
    const maxWords = 4;
    const maxLength = 50;

    /**
     * We apply a limit to the length and word count of the title to prevent
     * the service name from being too long or containing too many words which
     * is not likely to be a good service name.
     */
    const validLength = (text: string): boolean => {
      const validLength = text.length >= 3 && text.length <= maxLength;
      const validWordCount = text.split(/[\s|\-—/\\]+/).length <= maxWords;
      return validLength && validWordCount;
    };

    /**
     * Filter out common words from prefix/suffix until no more matches found
     */
    const getMeaningfulTitleParts = (title: string): string[] => {
      const words = title.toLowerCase().split(' ').map(word => word.toLowerCase());

      // Strip stopwords from start until no more matches
      let startIndex = 0;
      while (startIndex < words.length && CombinedStopWords.has(words[startIndex].toLowerCase())) {
        startIndex++;
      }

      // Strip stopwords from end until no more matches
      let endIndex = words.length - 1;
      while (endIndex > startIndex && CombinedStopWords.has(words[endIndex].toLowerCase())) {
        endIndex--;
      }

      // Return remaining words
      return words.slice(startIndex, endIndex + 1);
    };

    /**
     * Get original case version of meaningful words
     */
    const getOriginalCase = (text: string, meaningfulParts: string[]): string => {
      return text
        .split(/[\s|]+/)
        .filter(word => meaningfulParts.includes(word.toLowerCase()))
        .join(' ');
    };

    // Domain name suggestion (always included as fallback or first suggestion)
    const domainSuggestion = location.hostname.replace(/^www\./, '');

    // First try to extract meaningful parts based on the divider
    const dividerRegex = /[|\-—/\\:]/;
    const dividerMatch = dividerRegex.exec(title);
    if (dividerMatch) {
      const dividerIndex = dividerMatch.index;
      const beforeDivider = title.substring(0, dividerIndex).trim();
      const afterDivider = title.substring(dividerIndex + 1).trim();

      // Count meaningful words on each side
      const beforeWords = getMeaningfulTitleParts(beforeDivider);
      const afterWords = getMeaningfulTitleParts(afterDivider);

      // Get both parts in original case
      const beforePart = getOriginalCase(beforeDivider, beforeWords);
      const afterPart = getOriginalCase(afterDivider, afterWords);

      // Check if both parts are valid
      const beforeValid = validLength(beforePart);
      const afterValid = validLength(afterPart);

      // If both parts are valid, return both as suggestions
      if (beforeValid && afterValid) {
        return [beforePart, afterPart, domainSuggestion];
      }

      // If only one part is valid, return it
      if (beforeValid) {
        return [beforePart, domainSuggestion];
      }
      if (afterValid) {
        return [afterPart, domainSuggestion];
      }
    }

    // If no meaningful parts found after divider, try the full title
    const meaningfulParts = getMeaningfulTitleParts(title);
    const serviceName = getOriginalCase(title, meaningfulParts);
    if (validLength(serviceName)) {
      return [serviceName, domainSuggestion];
    }

    // Fall back to domain name
    return [domainSuggestion];
  }

  /**
   * Get the form wrapper element.
   */
  private getFormWrapper(): HTMLElement | null {
    return this.clickedElement?.closest('form, [role="dialog"]') as HTMLElement | null;
  }

  /**
   * Check if an element and all its parents are visible.
   * This checks for display:none, visibility:hidden, and opacity:0
   * Uses a cache to avoid redundant checks of the same elements.
   */
  private isElementVisible(element: HTMLElement | null): boolean {
    if (!element) {
      return false;
    }

    // Check cache first
    if (this.visibilityCache.has(element)) {
      return this.visibilityCache.get(element)!;
    }

    let current: HTMLElement | null = element;
    while (current) {
      try {
        const style = this.document.defaultView?.getComputedStyle(current);
        if (!style) {
          // Cache and return true for this element and all its parents
          let parent: HTMLElement | null = current;
          while (parent) {
            this.visibilityCache.set(parent, true);
            parent = parent.parentElement;
          }
          return true;
        }

        // Check for display:none
        if (style.display === 'none') {
          // Cache and return false for this element and all its parents
          let parent: HTMLElement | null = current;
          while (parent) {
            this.visibilityCache.set(parent, false);
            parent = parent.parentElement;
          }
          return false;
        }

        // Check for visibility:hidden
        if (style.visibility === 'hidden') {
          // Cache and return false for this element and all its parents
          let parent: HTMLElement | null = current;
          while (parent) {
            this.visibilityCache.set(parent, false);
            parent = parent.parentElement;
          }
          return false;
        }

        // Check for opacity:0
        if (parseFloat(style.opacity) === 0) {
          // Cache and return false for this element and all its parents
          let parent: HTMLElement | null = current;
          while (parent) {
            this.visibilityCache.set(parent, false);
            parent = parent.parentElement;
          }
          return false;
        }
      } catch {
        // If we can't get computed style, cache and return true for this element and all its parents
        let parent: HTMLElement | null = current;
        while (parent) {
          this.visibilityCache.set(parent, true);
          parent = parent.parentElement;
        }
        return true;
      }

      current = current.parentElement;
    }

    // Cache and return true for the original element
    this.visibilityCache.set(element, true);
    return true;
  }

  /**
   * Find all input/select elements matching patterns and types, ordered by best match.
   */
  private findAllInputFields(
    form: HTMLFormElement | null,
    patterns: string[],
    types: string[],
    excludeElements: HTMLInputElement[] = []
  ): HTMLInputElement[] {
    // Query for both standard input elements and any element with a type attribute
    const candidates = form
      ? form.querySelectorAll<HTMLElement>('input, select, [type]')
      : this.document.querySelectorAll<HTMLElement>('input, select, [type]');

    const matches: { input: HTMLInputElement; score: number }[] = [];

    for (const input of Array.from(candidates)) {
      if (excludeElements.includes(input as HTMLInputElement)) {
        continue;
      }

      if (!this.isElementVisible(input)) {
        continue;
      }

      // Get type from either the element's type property or its type attribute
      const type = input.tagName.toLowerCase() === 'select'
        ? 'select'
        : (input as HTMLInputElement).type?.toLowerCase() || input.getAttribute('type')?.toLowerCase() || '';

      if (!types.includes(type)) {
        continue;
      }

      if (types.includes('email') && type === 'email') {
        matches.push({ input: input as HTMLInputElement, score: -1 });
        continue;
      }

      // Collect all text attributes to check
      const attributesToCheck = [
        input.id,
        input.getAttribute('name'),
        input.getAttribute('placeholder')
      ]
        .map(a => a?.toLowerCase() ?? '');

      // Check for associated labels if input has an ID or name
      if (input.id || input.getAttribute('name')) {
        const label = this.document.querySelector(`label[for="${input.id || input.getAttribute('name')}"]`);
        if (label) {
          attributesToCheck.push(label.textContent?.toLowerCase() ?? '');
        }
      }

      // Check for sibling elements with class containing "label"
      const parent = input.parentElement;
      if (parent) {
        for (const sib of Array.from(parent.children)) {
          if (
            sib !== input &&
            Array.from(sib.classList).some(c => c.toLowerCase().includes('label'))
          ) {
            attributesToCheck.push(sib.textContent?.toLowerCase() ?? '');
          }
        }
      }

      // Check for parent label and table cell structure
      let currentElement: HTMLElement | null = input;
      for (let depth = 0; depth < 5 && currentElement; depth++) {
        // Stop if we have too many child elements (near body)
        if (currentElement.children.length > 15) {
          break;
        }

        // Check for label - search both parent and child elements
        const childLabel = currentElement.querySelector('label');
        if (childLabel) {
          attributesToCheck.push(childLabel.textContent?.toLowerCase() ?? '');
          break;
        }

        // Check for table cell structure
        const td = currentElement.closest('td');
        if (td) {
          // Get the parent row
          const row = td.closest('tr');
          if (row) {
            // Check all sibling cells in the row
            for (const cell of Array.from(row.querySelectorAll('td'))) {
              if (cell !== td) {
                attributesToCheck.push(cell.textContent?.toLowerCase() ?? '');
                break;
              }
            }
          }
          break;
        }

        currentElement = currentElement.parentElement;
      }

      let bestIndex = patterns.length;
      for (let i = 0; i < patterns.length; i++) {
        if (attributesToCheck.some(a => a.includes(patterns[i]))) {
          bestIndex = i;
          break;
        }
      }
      if (bestIndex < patterns.length) {
        matches.push({ input: input as HTMLInputElement, score: bestIndex });
      }
    }

    return matches
      .sort((a, b) => a.score - b.score)
      .map(m => m.input);
  }

  /**
   * Find a single input/select element based on common patterns in its attributes.
   */
  private findInputField(
    form: HTMLFormElement | null,
    patterns: string[],
    types: string[],
    excludeElements: HTMLInputElement[] = []
  ): HTMLInputElement | null {
    const all = this.findAllInputFields(form, patterns, types, excludeElements);
    // if email type explicitly requested, prefer actual <input type="email">
    if (types.includes('email')) {
      const emailMatch = all.find(i => (i.type || '').toLowerCase() === 'email');
      if (emailMatch) {
        return emailMatch;
      }
    }
    return all.length > 0 ? all[0] : null;
  }

  /**
   * Find the email field in the form.
   */
  private findEmailField(form: HTMLFormElement | null): {
    primary: HTMLInputElement | null,
    confirm: HTMLInputElement | null
  } {
    // Find primary email field
    const primaryEmail = this.findInputField(
      form,
      CombinedFieldPatterns.email,
      ['text', 'email']
    );

    /*
     * Find confirmation email field if primary exists
     * and ensure it's not the same as the primary email field.
     */
    const confirmEmail = primaryEmail
      ? this.findInputField(
        form,
        CombinedFieldPatterns.emailConfirm,
        ['text', 'email'],
        [primaryEmail]
      )
      : null;

    return {
      primary: primaryEmail,
      confirm: confirmEmail
    };
  }

  /**
   * Find the birthdate fields in the form.
   */
  private findBirthdateFields(form: HTMLFormElement | null, excludeElements: HTMLInputElement[] = []): FormFields['birthdateField'] {
    // First try to find a single date input
    const singleDateField = this.findInputField(form, CombinedFieldPatterns.birthdate, ['date', 'text'], excludeElements);

    // Detect date format by searching all text content in the form
    let format = 'yyyy-mm-dd'; // default format
    if (form && singleDateField) {
      // Get the parent container
      const container = singleDateField.closest('div');
      if (container) {
        // Collect text from all relevant elements
        const elements = [
          ...Array.from(container.getElementsByTagName('label')),
          ...Array.from(container.getElementsByTagName('span')),
          container
        ];

        const allText = elements
          .map(el => el.textContent?.toLowerCase() ?? '')
          .join(' ')
          // Normalize different types of spaces and separators
          .replace(/[\s\u00A0]/g, '')
          // Don't replace separators yet to detect the preferred one
          .toLowerCase();

        // Check for date format patterns with either slash or dash
        if (/dd[-/]mm[-/]jj/i.test(allText) || /dd[-/]mm[-/]yyyy/i.test(allText)) {
          // Determine separator style from the matched pattern
          format = allText.includes('/') ? 'dd/mm/yyyy' : 'dd-mm-yyyy';
        } else if (/mm[-/]dd[-/]yyyy/i.test(allText)) {
          format = allText.includes('/') ? 'mm/dd/yyyy' : 'mm-dd-yyyy';
        } else if (/yyyy[-/]mm[-/]dd/i.test(allText)) {
          format = allText.includes('/') ? 'yyyy/mm/dd' : 'yyyy-mm-dd';
        }

        // Check placeholder as fallback
        if (format === 'yyyy-mm-dd' && singleDateField.placeholder) {
          const placeholder = singleDateField.placeholder.toLowerCase();
          if (/dd[-/]mm/i.test(placeholder)) {
            format = placeholder.includes('/') ? 'dd/mm/yyyy' : 'dd-mm-yyyy';
          } else if (/mm[-/]dd/i.test(placeholder)) {
            format = placeholder.includes('/') ? 'mm/dd/yyyy' : 'mm-dd-yyyy';
          }
        }
      }
    }

    if (singleDateField) {
      return {
        single: singleDateField,
        format,
        day: null,
        month: null,
        year: null
      };
    }

    // Look for separate day/month/year fields
    const dayField = this.findInputField(form, CombinedFieldPatterns.birthDateDay, ['text', 'number', 'select'], excludeElements);
    const monthField = this.findInputField(form, CombinedFieldPatterns.birthDateMonth, ['text', 'number', 'select'], excludeElements);
    const yearField = this.findInputField(form, CombinedFieldPatterns.birthDateYear, ['text', 'number', 'select'], excludeElements);

    return {
      single: null,
      format: 'yyyy-mm-dd', // Default format for separate fields
      day: dayField,
      month: monthField,
      year: yearField
    };
  }

  /**
   * Find the gender field in the form.
   */
  private findGenderField(form: HTMLFormElement | null, excludeElements: HTMLInputElement[] = []): FormFields['genderField'] {
    // Try to find select or input element using the shared method
    const genderField = this.findInputField(
      form,
      CombinedFieldPatterns.gender,
      ['select'],
      excludeElements
    );

    if (genderField?.tagName.toLowerCase() === 'select') {
      return {
        type: 'select',
        field: genderField
      };
    }

    // Try to find radio buttons
    const radioButtons = form
      ? form.querySelectorAll<HTMLInputElement>('input[type="radio"][name*="gender"], input[type="radio"][name*="sex"]')
      : null;

    if (radioButtons && radioButtons.length > 0) {
      /**
       * Find a radio button by patterns.
       */
      const findRadioByPatterns = (patterns: string[], isOther: boolean = false) : HTMLInputElement | null => {
        return Array.from(radioButtons).find(radio => {
          const attributes = [
            radio.value,
            radio.id,
            radio.name,
            radio.labels?.[0]?.textContent ?? ''
          ].map(attr => attr?.toLowerCase() ?? '');

          // For "other" patterns, skip if it matches male or female patterns
          if (isOther && (
            CombinedGenderOptionPatterns.male.some(pattern => attributes.some(attr => attr.includes(pattern))) ||
            CombinedGenderOptionPatterns.female.some(pattern => attributes.some(attr => attr.includes(pattern)))
          )) {
            return false;
          }

          return patterns.some(pattern =>
            attributes.some(attr => attr.includes(pattern))
          );
        }) ?? null;
      };

      return {
        type: 'radio',
        field: null, // Set to null since we're providing specific mappings
        radioButtons: {
          male: findRadioByPatterns(CombinedGenderOptionPatterns.male),
          female: findRadioByPatterns(CombinedGenderOptionPatterns.female),
          other: findRadioByPatterns(CombinedGenderOptionPatterns.other)
        }
      };
    }

    // Fall back to regular text input
    const textField = this.findInputField(form, CombinedFieldPatterns.gender, ['text'], excludeElements);

    return {
      type: 'text',
      field: textField
    };
  }

  /**
   * Find the password field in a form.
   */
  private findPasswordField(form: HTMLFormElement | null): {
    primary: HTMLInputElement | null,
    confirm: HTMLInputElement | null
  } {
    const passwordFields = this.findAllInputFields(form, CombinedFieldPatterns.password, ['password']);

    return {
      primary: passwordFields[0] ?? null,
      confirm: passwordFields[1] ?? null
    };
  }

  /**
   * Check if a form contains a password field.
   */
  private containsPasswordField(wrapper: HTMLElement): boolean {
    const passwordFields = this.findPasswordField(wrapper as HTMLFormElement | null);
    if (passwordFields.primary && this.isElementVisible(passwordFields.primary)) {
      return true;
    }

    return false;
  }

  /**
   * Check if a form contains a likely username or email field.
   */
  private containsLikelyUsernameOrEmailField(wrapper: HTMLElement): boolean {
    // Check if the form contains an email field.
    const emailFields = this.findEmailField(wrapper as HTMLFormElement | null);
    if (emailFields.primary && this.isElementVisible(emailFields.primary)) {
      return true;
    }

    // Check if the form contains a username field.
    const usernameField = this.findInputField(wrapper as HTMLFormElement | null, CombinedFieldPatterns.username, ['text'], []);
    if (usernameField && this.isElementVisible(usernameField)) {
      return true;
    }

    // Check if the form contains a first name field.
    const firstNameField = this.findInputField(wrapper as HTMLFormElement | null, CombinedFieldPatterns.firstName, ['text'], []);
    if (firstNameField && this.isElementVisible(firstNameField)) {
      return true;
    }

    // Check if the form contains a last name field.
    const lastNameField = this.findInputField(wrapper as HTMLFormElement | null, CombinedFieldPatterns.lastName, ['text'], []);
    if (lastNameField && this.isElementVisible(lastNameField)) {
      return true;
    }

    return false;
  }

  /**
   * Check if a field is an autofill-triggerable field (username, email, or password).
   */
  public isAutofillTriggerableField(): boolean {
    // Check if it's a username, email or password field by reusing the existing detection logic
    const formWrapper = this.getFormWrapper();

    // Check if the clicked element is a username field.
    const usernameFields = this.findAllInputFields(formWrapper as HTMLFormElement | null, CombinedFieldPatterns.username, ['text']);
    if (usernameFields.some(input => input === this.clickedElement)) {
      return true;
    }

    // Check if the clicked element is a password field.
    const passwordField = this.findPasswordField(formWrapper as HTMLFormElement | null);
    if (passwordField.primary === this.clickedElement || passwordField.confirm === this.clickedElement) {
      return true;
    }

    // Check if the clicked element is an email field.
    const emailFields = this.findAllInputFields(formWrapper as HTMLFormElement | null, CombinedFieldPatterns.email, ['text', 'email']);
    if (emailFields.some(input => input === this.clickedElement)) {
      return true;
    }

    return false;
  }

  /**
   * Create a form entry.
   */
  private detectFormFields(wrapper: HTMLElement | null): FormFields {
    // Keep track of detected fields to prevent overlap
    const detectedFields: HTMLInputElement[] = [];

    // Find fields in priority order (most specific to least specific).
    const emailFields = this.findEmailField(wrapper as HTMLFormElement | null);
    if (emailFields.primary) {
      detectedFields.push(emailFields.primary);
    }
    if (emailFields.confirm) {
      detectedFields.push(emailFields.confirm);
    }

    const passwordFields = this.findPasswordField(wrapper as HTMLFormElement | null);
    if (passwordFields.primary) {
      detectedFields.push(passwordFields.primary);
    }
    if (passwordFields.confirm) {
      detectedFields.push(passwordFields.confirm);
    }

    const usernameField = this.findInputField(wrapper as HTMLFormElement | null, CombinedFieldPatterns.username, ['text'], detectedFields);
    if (usernameField) {
      detectedFields.push(usernameField);
    }

    const fullNameField = this.findInputField(wrapper as HTMLFormElement | null, CombinedFieldPatterns.fullName, ['text'], detectedFields);
    if (fullNameField) {
      detectedFields.push(fullNameField);
    }

    const lastNameField = this.findInputField(wrapper as HTMLFormElement | null, CombinedFieldPatterns.lastName, ['text'], detectedFields);
    if (lastNameField) {
      detectedFields.push(lastNameField);
    }

    const firstNameField = this.findInputField(wrapper as HTMLFormElement | null, CombinedFieldPatterns.firstName, ['text'], detectedFields);
    if (firstNameField) {
      detectedFields.push(firstNameField);
    }

    const birthdateField = this.findBirthdateFields(wrapper as HTMLFormElement | null, detectedFields);
    if (birthdateField.single) {
      detectedFields.push(birthdateField.single);
    }
    if (birthdateField.day) {
      detectedFields.push(birthdateField.day);
    }
    if (birthdateField.month) {
      detectedFields.push(birthdateField.month);
    }
    if (birthdateField.year) {
      detectedFields.push(birthdateField.year);
    }

    const genderField = this.findGenderField(wrapper as HTMLFormElement | null, detectedFields);
    if (genderField.field) {
      detectedFields.push(genderField.field as HTMLInputElement);
    }

    return {
      form: wrapper as HTMLFormElement,
      emailField: emailFields.primary,
      emailConfirmField: emailFields.confirm,
      usernameField,
      passwordField: passwordFields.primary,
      passwordConfirmField: passwordFields.confirm,
      fullNameField,
      firstNameField,
      lastNameField,
      birthdateField,
      genderField
    };
  }
}
