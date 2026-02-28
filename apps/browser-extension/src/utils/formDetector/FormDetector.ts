import { CombinedEmailVerificationPatterns, CombinedFieldPatterns, CombinedGenderOptionPatterns, CombinedStopWords } from "./FieldPatterns";
import { DetectedFieldType, FormFields } from "./types/FormFields";

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
    this.visibilityCache = new Map();

    /*
     * Only trust clickedElement if it and its ancestors are visible.
     */
    if (clickedElement) {
      // Check parents strictly (including opacity)
      let parent = clickedElement.parentElement;
      let parentVisible = true;

      while (parent && parent !== this.document.body) {
        if (!this.isElementVisible(parent, true)) {
          parentVisible = false;
          break;
        }
        parent = parent.parentElement;
      }

      // Check element itself without opacity check (allow opacity:0 for transitions)
      const style = document.defaultView?.getComputedStyle(clickedElement);
      const elementStrictlyHidden = style?.display === 'none' || style?.visibility === 'hidden';

      if (parentVisible && !elementStrictlyHidden) {
        this.clickedElement = clickedElement;
      } else {
        this.clickedElement = null;
      }
    } else {
      this.clickedElement = null;
    }
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

    // Check if the wrapper contains a password, likely username field, or TOTP field before processing.
    const hasPasswordField = this.containsPasswordField(formWrapper);
    const hasUsernameOrEmailField = this.containsLikelyUsernameOrEmailField(formWrapper);
    const hasTotpField = this.containsTotpField(formWrapper);

    if (hasPasswordField || hasUsernameOrEmailField || hasTotpField) {
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
    const wrapper = this.clickedElement?.closest('form, [role="dialog"]') as HTMLElement | null;
    return wrapper;
  }

  /**
   * Get the actual input element from a potentially custom element.
   * This handles any element with shadow DOM containing input elements.
   * @param element The element to check (could be a custom element or regular input)
   * @returns The actual input element, or the original element if no nested input is found
   */
  private getActualInputElement(element: HTMLElement): HTMLElement {
    // If it's already an input, return it
    if (element.tagName.toLowerCase() === 'input') {
      return element;
    }

    // Check for shadow DOM input (generic approach)
    const elementWithShadow = element as HTMLElement & { shadowRoot?: ShadowRoot };
    if (elementWithShadow.shadowRoot) {
      const shadowInput = elementWithShadow.shadowRoot.querySelector('input, textarea') as HTMLElement;
      if (shadowInput) {
        return shadowInput;
      }
    }

    // Check for regular child input (non-shadow DOM)
    const childInput = element.querySelector('input, textarea') as HTMLElement;
    if (childInput) {
      return childInput;
    }

    // Return the original element if no nested input found
    return element;
  }

  /**
   * Check if an element and all its parents are visible.
   * This checks for display:none, visibility:hidden, and optionally opacity:0
   * Uses a cache to avoid redundant checks of the same elements.
   *
   * @param element - The element to check
   * @param checkOpacity - Whether to check opacity (default: true). Set to false to allow
   *                       fields with opacity:0 that are used in transition animations.
   */
  private isElementVisible(element: HTMLElement | null, checkOpacity: boolean = true): boolean {
    if (!element) {
      return false;
    }

    /*
     * Note: We don't cache when checkOpacity is false to avoid returning incorrect results.
     * The cache is only used for the default strict visibility checks.
     */
    if (checkOpacity && this.visibilityCache.has(element)) {
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
            if (checkOpacity) {
              this.visibilityCache.set(parent, true);
            }
            parent = parent.parentElement;
          }
          return true;
        }

        /*
         * Always check display:none and visibility:hidden for security.
         * Only opacity:0 is optionally skipped for transition animations.
         */

        // Check for display:none
        if (style.display === 'none') {
          // Cache and return false for this element and all its parents
          let parent: HTMLElement | null = current;
          while (parent) {
            if (checkOpacity) {
              this.visibilityCache.set(parent, false);
            }
            parent = parent.parentElement;
          }
          return false;
        }

        // Check for visibility:hidden
        if (style.visibility === 'hidden') {
          // Cache and return false for this element and all its parents
          let parent: HTMLElement | null = current;
          while (parent) {
            if (checkOpacity) {
              this.visibilityCache.set(parent, false);
            }
            parent = parent.parentElement;
          }
          return false;
        }

        // Check opacity:0 only when checkOpacity is true (allows transition animations otherwise)
        if (checkOpacity && parseFloat(style.opacity) === 0) {
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
          if (checkOpacity) {
            this.visibilityCache.set(parent, true);
          }
          parent = parent.parentElement;
        }
        return true;
      }

      current = current.parentElement;
    }

    // Cache and return true for the original element
    if (checkOpacity) {
      this.visibilityCache.set(element, true);
    }
    return true;
  }

  /**
   * Find all input/select elements matching patterns and types, ordered by best match.
   */
  private findAllInputFields(
    form: HTMLFormElement | null,
    patterns: string[],
    types: string[],
    excludeElements: HTMLInputElement[] = [],
    checkVisibility: boolean = true
  ): HTMLInputElement[] {
    // Query for standard input elements, select elements, and elements with type attributes
    const standardCandidates = form
      ? Array.from(form.querySelectorAll<HTMLElement>('input, select, [type]'))
      : Array.from(this.document.querySelectorAll<HTMLElement>('input, select, [type]'));

    /**
     * Also find any custom elements that might contain shadow DOM inputs
     * Look for elements with shadow roots that contain input elements
     */
    const allElements = form
      ? Array.from(form.querySelectorAll<HTMLElement>('*'))
      : Array.from(this.document.querySelectorAll<HTMLElement>('*'));

    const shadowDOMCandidates = allElements.filter(el => {
      // Check if element has shadow DOM with input elements
      const elementWithShadow = el as HTMLElement & { shadowRoot?: ShadowRoot };
      if (elementWithShadow.shadowRoot) {
        const shadowInput = elementWithShadow.shadowRoot.querySelector('input, textarea');
        return shadowInput !== null;
      }
      return false;
    });

    // Combine and deduplicate candidates
    const allCandidates = [...standardCandidates, ...shadowDOMCandidates];
    const candidates = allCandidates.filter((el, index, arr) => arr.indexOf(el) === index);

    const matches: { input: HTMLInputElement; score: number }[] = [];

    for (const input of Array.from(candidates)) {
      if (excludeElements.includes(input as HTMLInputElement)) {
        continue;
      }

      // When user clicks a field, skip opacity checks to support transition animations
      if (checkVisibility) {
        const isVisible = this.isElementVisible(input, true);
        if (!isVisible) {
          continue;
        }
      } else {
        const isVisible = this.isElementVisible(input, false);
        if (!isVisible) {
          continue;
        }
      }

      // Get type from either the element's type property or its type attribute
      const tagName = input.tagName.toLowerCase();
      let type = tagName === 'select'
        ? 'select'
        : (input as HTMLInputElement).type?.toLowerCase() || input.getAttribute('type')?.toLowerCase() || '';

      // Check if element has shadow DOM with input elements (generic detection)
      const elementWithShadow = input as HTMLElement & { shadowRoot?: ShadowRoot };
      const hasShadowDOMInput = elementWithShadow.shadowRoot &&
        elementWithShadow.shadowRoot.querySelector('input, textarea');

      // For elements with shadow DOM, get the type from the actual input inside
      if (hasShadowDOMInput && !type) {
        const shadowInput = elementWithShadow.shadowRoot!.querySelector('input, textarea') as HTMLInputElement;
        if (shadowInput) {
          type = shadowInput.type?.toLowerCase() || 'text';
        }
      }

      // Check if this element should be considered based on type matching
      if (!types.includes(type)) {
        // For shadow DOM elements, allow if we're looking for text and it contains an input
        if (hasShadowDOMInput && types.includes('text') && !type) {
          // This is a shadow DOM element without explicit type, treat as text input
        } else {
          continue;
        }
      }

      if (types.includes('email') && type === 'email') {
        matches.push({ input: input as HTMLInputElement, score: -1 });
        continue;
      }

      /**
       * Check autocomplete attribute for direct field type matching.
       * First check our custom data-av-autocomplete attribute (set by AliasVault when disabling
       * native browser autofill), then fall back to the regular autocomplete attribute.
       */
      const autocomplete = (input.getAttribute('data-av-autocomplete') ?? input.getAttribute('autocomplete'))?.toLowerCase() ?? '';

      // Direct autocomplete matches take highest priority (score -2, higher than type=email at -1)
      if (autocomplete) {
        // Match autocomplete="username" for username patterns
        if (patterns === CombinedFieldPatterns.username && autocomplete === 'username') {
          matches.push({ input: input as HTMLInputElement, score: -2 });
          continue;
        }
        // Match autocomplete="email" for email patterns
        if (patterns === CombinedFieldPatterns.email && autocomplete === 'email') {
          matches.push({ input: input as HTMLInputElement, score: -2 });
          continue;
        }
        // Match autocomplete="current-password" or "new-password" for password patterns
        if (patterns === CombinedFieldPatterns.password &&
            (autocomplete === 'current-password' || autocomplete === 'new-password')) {
          matches.push({ input: input as HTMLInputElement, score: -2 });
          continue;
        }
      }

      /**
       * Check aria-describedby ID for direct field type matching (e.g., aria-describedby="usernameMessage")
       * Only match if it's a clear username indicator (not usernameConfirm, etc.)
       */
      const ariaDescribedById = input.getAttribute('aria-describedby')?.toLowerCase() ?? '';
      if (ariaDescribedById) {
        // Match aria-describedby containing "username" for username patterns
        if (patterns === CombinedFieldPatterns.username &&
            ariaDescribedById.includes('username')) {
          matches.push({ input: input as HTMLInputElement, score: -2 });
          continue;
        }
      }

      // Collect all text attributes to check
      const attributesToCheck = [
        input.id,
        input.getAttribute('name'),
        input.getAttribute('placeholder'),
        autocomplete
      ]
        .map(a => a?.toLowerCase() ?? '');

      // Check for associated labels if input has an ID or name
      if (input.id || input.getAttribute('name')) {
        const label = this.document.querySelector(`label[for="${input.id || input.getAttribute('name')}"]`);
        if (label) {
          attributesToCheck.push(label.textContent?.toLowerCase() ?? '');
        }
      }

      // Check aria-describedby for additional field hints
      const ariaDescribedBy = input.getAttribute('aria-describedby');
      if (ariaDescribedBy) {
        // aria-describedby can contain multiple space-separated IDs
        const describedByIds = ariaDescribedBy.split(/\s+/);
        for (const descId of describedByIds) {
          const describedByElement = this.document.getElementById(descId);
          if (describedByElement) {
            attributesToCheck.push(describedByElement.textContent?.toLowerCase() ?? '');
          }
        }
      }

      // Check aria-label attribute
      const ariaLabel = input.getAttribute('aria-label');
      if (ariaLabel) {
        attributesToCheck.push(ariaLabel.toLowerCase());
      }

      /**
       * Check for slot-based labels (e.g., <span slot="label">Email or username</span>)
       * Look for slot elements within the input's parent hierarchy
       */
      let slotParent: HTMLElement | null = input;
      for (let depth = 0; depth < 3 && slotParent; depth++) {
        const slotElements = slotParent.querySelectorAll('[slot="label"], [slot="helper-text"]');
        for (const slotEl of Array.from(slotElements)) {
          const slotText = slotEl.textContent?.toLowerCase() ?? '';
          if (slotText) {
            attributesToCheck.push(slotText);
          }
        }
        /** Also check if the parent itself is a custom element with slots */
        if (slotParent.shadowRoot) {
          const shadowSlots = slotParent.shadowRoot.querySelectorAll('slot[name="label"], slot[name="helper-text"]');
          for (const slot of Array.from(shadowSlots)) {
            const assignedNodes = (slot as HTMLSlotElement).assignedNodes();
            for (const node of assignedNodes) {
              if (node.textContent) {
                attributesToCheck.push(node.textContent.toLowerCase());
              }
            }
          }
        }
        slotParent = slotParent.parentElement;
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
    excludeElements: HTMLInputElement[] = [],
    checkVisibility: boolean = true
  ): HTMLInputElement | null {
    const all = this.findAllInputFields(form, patterns, types, excludeElements, checkVisibility);

    // Filter out parent-child duplicates and fields overlapping with excludeElements
    const filtered = this.filterOutNestedDuplicates(all, excludeElements);

    // if email type explicitly requested, prefer actual <input type="email">
    if (types.includes('email')) {
      const emailMatch = filtered.find(i => (i.type || '').toLowerCase() === 'email');
      if (emailMatch) {
        return emailMatch;
      }
    }
    return filtered.length > 0 ? filtered[0] : null;
  }

  /**
   * Find the email field in the form.
   */
  private findEmailField(form: HTMLFormElement | null, checkVisibility: boolean = true): {
    primary: HTMLInputElement | null,
    confirm: HTMLInputElement | null
  } {

    // Find all email fields first
    const emailFields = this.findAllInputFields(
      form,
      CombinedFieldPatterns.email,
      ['text', 'email'],
      [],
      checkVisibility
    );

    /*
     * Filter out parent-child relationships
     */
    const filteredEmailFields = this.filterOutNestedDuplicates(emailFields);

    /*
     * Filter out fields that are more likely to be username fields.
     * Some forms have labels like "Username / Email" or "Gebruikersnaam / e-mailadres"
     * which can match both patterns. We need to check if the label contains BOTH
     * username and email keywords to determine if this is a dual-purpose field.
     */
    const emailFieldsWithoutUsernamePriority = filteredEmailFields.filter(field => {
      const fieldName = (field.getAttribute('name') || '').toLowerCase();
      const fieldId = (field.id || '').toLowerCase();
      const fieldAttributes = `${fieldName} ${fieldId}`;

      /*
       * Get the label text for this field
       */
      let labelText = '';
      if (field.id || fieldName) {
        const label = this.document.querySelector(`label[for="${field.id || fieldName}"]`);
        if (label) {
          labelText = (label.textContent || '').toLowerCase();
        }
      }

      /*
       * Check if label contains BOTH username and email patterns (dual-purpose field)
       */
      const labelHasUsername = CombinedFieldPatterns.username.some(pattern =>
        labelText.includes(pattern)
      );
      const labelHasEmail = CombinedFieldPatterns.email.some(pattern =>
        labelText.includes(pattern)
      );

      /*
       * Only filter out if:
       * 1. Label contains BOTH username and email keywords (dual-purpose label)
       * 2. AND the field's name/id contains username pattern but NOT email pattern
       */
      if (labelHasUsername && labelHasEmail) {
        const hasUsernameInNameOrId = CombinedFieldPatterns.username.some(pattern =>
          fieldAttributes.includes(pattern)
        );
        const hasEmailInNameOrId = CombinedFieldPatterns.email.some(pattern =>
          fieldAttributes.includes(pattern)
        );

        if (hasUsernameInNameOrId && !hasEmailInNameOrId) {
          return false;
        }
      }

      return true;
    });

    const primaryEmail = emailFieldsWithoutUsernamePriority[0] ?? null;

    /*
     * Find confirmation email field if primary exists
     * and ensure it's not the same as the primary email field.
     */
    const confirmEmailFields = primaryEmail
      ? this.findAllInputFields(
        form,
        CombinedFieldPatterns.emailConfirm,
        ['text', 'email'],
        [primaryEmail],
        checkVisibility
      )
      : [];

    const filteredConfirmFields = this.filterOutNestedDuplicates(confirmEmailFields);
    const confirmEmail = filteredConfirmFields[0] ?? null;

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
   * Filter out nested duplicates where a parent element and its child are both detected.
   * This happens with custom elements that contain actual input elements.
   * We prefer the innermost actual input element over the parent custom element.
   * Also excludes fields that overlap with already-detected fields.
   */
  private filterOutNestedDuplicates(fields: HTMLInputElement[], excludeElements: HTMLInputElement[] = []): HTMLInputElement[] {
    if (fields.length === 0) {
      return fields;
    }

    const filtered: HTMLInputElement[] = [];

    for (const field of fields) {
      let shouldInclude = true;

      // Check if this field overlaps with any excluded element
      for (const excluded of excludeElements) {
        // Skip if field is the same as excluded
        if (field === excluded) {
          shouldInclude = false;
          break;
        }

        // Skip if field is a child of excluded element
        if (excluded.contains(field)) {
          shouldInclude = false;
          break;
        }

        // Skip if field is a parent of excluded element
        if (field.contains(excluded)) {
          shouldInclude = false;
          break;
        }

        // Check shadow DOM relationships
        const fieldWithShadow = field as HTMLElement & { shadowRoot?: ShadowRoot };
        const excludedWithShadow = excluded as HTMLElement & { shadowRoot?: ShadowRoot };

        // Skip if excluded element's shadow DOM contains this field
        if (excludedWithShadow.shadowRoot && excludedWithShadow.shadowRoot.contains(field)) {
          shouldInclude = false;
          break;
        }

        // Skip if this field's shadow DOM contains the excluded element
        if (fieldWithShadow.shadowRoot && fieldWithShadow.shadowRoot.contains(excluded)) {
          shouldInclude = false;
          break;
        }

        // Get actual input elements and compare those
        const actualField = this.getActualInputElement(field);
        const actualExcluded = this.getActualInputElement(excluded);

        // Skip if the actual inputs are the same
        if (actualField === actualExcluded) {
          shouldInclude = false;
          break;
        }
      }

      if (!shouldInclude) {
        continue;
      }

      // Check if this field is a parent of any other field in the list
      for (const otherField of fields) {
        if (field !== otherField) {
          // Check if field contains otherField (field is parent)
          if (field.contains(otherField)) {
            shouldInclude = false;
            break;
          }

          // Check if field's shadow DOM contains otherField
          const fieldWithShadow = field as HTMLElement & { shadowRoot?: ShadowRoot };
          if (fieldWithShadow.shadowRoot && fieldWithShadow.shadowRoot.contains(otherField)) {
            shouldInclude = false;
            break;
          }
        }
      }

      if (shouldInclude) {
        // Also check if this field is not already represented by its actual input
        const actualInput = this.getActualInputElement(field);
        if (actualInput !== field) {
          // If the actual input is also in the list, skip the parent
          if (fields.includes(actualInput as HTMLInputElement)) {
            continue;
          }
        }

        filtered.push(field);
      }
    }

    return filtered;
  }

  /**
   * Find the password field in a form.
   */
  private findPasswordField(form: HTMLFormElement | null, checkVisibility: boolean = true): {
    primary: HTMLInputElement | null,
    confirm: HTMLInputElement | null
  } {
    const passwordFields = this.findAllInputFields(form, CombinedFieldPatterns.password, ['password'], [], checkVisibility);

    // Filter out parent-child relationships to avoid detecting the same field twice
    const filteredFields = this.filterOutNestedDuplicates(passwordFields);

    return {
      primary: filteredFields[0] ?? null,
      confirm: filteredFields[1] ?? null
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
   * Check if a form contains a TOTP/2FA field.
   */
  private containsTotpField(wrapper: HTMLElement): boolean {
    const totpField = this.findTotpField(wrapper as HTMLFormElement | null);
    return totpField !== null && this.isElementVisible(totpField);
  }

  /**
   * Check if the form context indicates this is an email verification form.
   * Email verification forms should not be treated as TOTP/2FA forms.
   *
   * This method uses localized heuristics to avoid false positives from unrelated page content.
   * It looks for specific patterns that distinguish email verification from TOTP/2FA authentication.
   */
  private isEmailVerificationForm(): boolean {
    if (!this.clickedElement) {
      return false;
    }

    /*
     * Search upward from the clicked element to find visible text and links
     * This gives us a localized context without needing to scan the entire page
     */
    let searchRoot: HTMLElement = this.clickedElement;
    let depth = 0;

    // Go up to find a reasonable container (max 15 levels)
    while (searchRoot.parentElement && depth < 15) {
      searchRoot = searchRoot.parentElement;
      depth++;

      // Stop if we found a form, dialog, or main container
      if (searchRoot.tagName === 'FORM' ||
          searchRoot.getAttribute('role') === 'dialog' ||
          searchRoot.tagName === 'MAIN' ||
          searchRoot.id ||
          searchRoot.className.includes('container')) {
        break;
      }
    }

    // Get text content and links from this localized area
    const contextText = searchRoot.textContent || '';
    const links = Array.from(searchRoot.querySelectorAll('a, button'));
    const linkTexts = links.map(link => link.textContent?.toLowerCase() || '');
    const allLinkText = linkTexts.join(' ');

    /*
     * Check for email address pattern (including masked like "user@***.com")
     * Email verification forms typically display the email address
     * Pattern: something @ something . something (allows masked emails with asterisks)
     */
    const hasEmailPattern = /[a-z0-9*.\-_]+@[a-z0-9*.-]+\.[a-z*]{2,}/i.test(contextText);

    if (!hasEmailPattern) {
      // No email shown = not email verification
      return false;
    }

    // Check for "resend code" links using language-aware patterns (common in email verification, rare in TOTP)
    const hasResend = CombinedEmailVerificationPatterns.resendCode.some(pattern => pattern.test(allLinkText));

    // Check for "change/update email" options using language-aware patterns
    const hasChangeEmail = CombinedEmailVerificationPatterns.changeEmail.some(pattern => pattern.test(allLinkText));

    // Email verification = shows email AND has resend OR change email option
    return hasEmailPattern && (hasResend || hasChangeEmail);
  }

  /**
   * Find a TOTP/2FA input field in the form.
   * Uses pattern matching and heuristics specific to TOTP fields.
   */
  private findTotpField(form: HTMLFormElement | null): HTMLInputElement | null {
    // Check if this is an email verification form (not TOTP/2FA)
    if (this.isEmailVerificationForm()) {
      return null;
    }

    // First try pattern-based detection
    const candidates = this.findAllInputFields(
      form,
      CombinedFieldPatterns.totp,
      ['text', 'number']
    );

    // Filter out parent-child duplicates
    const filteredCandidates = this.filterOutNestedDuplicates(candidates);

    if (filteredCandidates.length > 0) {
      return filteredCandidates[0];
    }

    // Additional heuristics for TOTP fields that may not match patterns
    const allInputs = form
      ? Array.from(form.querySelectorAll<HTMLInputElement>('input'))
      : Array.from(this.document.querySelectorAll<HTMLInputElement>('input'));

    for (const input of allInputs) {
      if (!this.isElementVisible(input)) {
        continue;
      }

      // Check for autocomplete="one-time-code"
      const autocomplete = input.getAttribute('autocomplete')?.toLowerCase() ?? '';
      if (autocomplete === 'one-time-code') {
        return input;
      }

      // Check for maxLength=6 combined with inputmode="numeric"
      const maxLength = input.maxLength;
      const inputMode = input.getAttribute('inputmode');
      if (maxLength === 6 && inputMode === 'numeric') {
        return input;
      }

      // Check for type="tel" with maxLength=6 (common for 2FA codes like Entra ID)
      const inputType = input.type?.toLowerCase();
      if (inputType === 'tel' && maxLength === 6) {
        return input;
      }

      // Check for numeric pattern attribute with length constraint
      const pattern = input.getAttribute('pattern');
      if (pattern && (/^\[0-9\]/.test(pattern) || /^\\d/.test(pattern)) && (maxLength === 6 || maxLength === 1)) {
        return input;
      }

      // Check for maxLength=1 with inputmode="numeric" (split TOTP inputs)
      if (maxLength === 1 && inputMode === 'numeric') {
        return input;
      }
    }

    return null;
  }

  /**
   * Check if a form contains a likely username or email field.
   * Skips visibility checks when user clicked a field to support transition animations.
   */
  private containsLikelyUsernameOrEmailField(wrapper: HTMLElement): boolean {
    const skipVisibilityCheck = this.clickedElement !== null;

    // Check if the form contains an email field
    const emailFields = this.findEmailField(wrapper as HTMLFormElement | null, !skipVisibilityCheck);

    if (emailFields.primary) {
      return true;
    }

    // Check if the form contains a username field
    const usernameField = this.findInputField(
      wrapper as HTMLFormElement | null,
      CombinedFieldPatterns.username,
      ['text'],
      [],
      !skipVisibilityCheck
    );

    if (usernameField) {
      return true;
    }

    // Check if the form contains a first name field
    const firstNameField = this.findInputField(
      wrapper as HTMLFormElement | null,
      CombinedFieldPatterns.firstName,
      ['text'],
      [],
      !skipVisibilityCheck
    );

    if (firstNameField) {
      return true;
    }

    // Check if the form contains a last name field
    const lastNameField = this.findInputField(
      wrapper as HTMLFormElement | null,
      CombinedFieldPatterns.lastName,
      ['text'],
      [],
      !skipVisibilityCheck
    );

    if (lastNameField) {
      return true;
    }

    return false;
  }

  /**
   * Check if a field is an autofill-triggerable field (username, email, or password).
   */
  public isAutofillTriggerableField(): boolean {
    return this.getDetectedFieldType() !== null;
  }

  /**
   * Get the detected field type for the clicked element.
   * Returns a DetectedFieldType enum value if detected, null otherwise.
   * First checks for our custom data-av-field-type attribute (set on previous interactions),
   * then falls back to full field detection.
   */
  public getDetectedFieldType(): DetectedFieldType | null {
    if (!this.clickedElement) {
      return null;
    }

    // First check if we already detected and stored the field type
    const storedFieldType = this.clickedElement.getAttribute('data-av-field-type');
    if (storedFieldType && Object.values(DetectedFieldType).includes(storedFieldType as DetectedFieldType)) {
      return storedFieldType as DetectedFieldType;
    }

    // Get the actual input element (handles shadow DOM)
    const actualElement = this.getActualInputElement(this.clickedElement);

    // Also check the actual element for stored field type
    if (actualElement !== this.clickedElement) {
      const actualStoredFieldType = actualElement.getAttribute('data-av-field-type');
      if (actualStoredFieldType && Object.values(DetectedFieldType).includes(actualStoredFieldType as DetectedFieldType)) {
        return actualStoredFieldType as DetectedFieldType;
      }
    }

    // Fall back to full field detection
    const formWrapper = this.getFormWrapper();

    // Check both the clicked element and the actual input element
    const elementsToCheck = [this.clickedElement, actualElement].filter((el, index, arr) =>
      el && arr.indexOf(el) === index // Remove duplicates
    );

    /*
     * When detecting field type from a clicked element, skip visibility checks
     * since the user clearly can see and interact with the field
     */
    const checkVisibility = false;

    // Check if any of the elements is a username field
    const usernameFields = this.findAllInputFields(formWrapper as HTMLFormElement | null, CombinedFieldPatterns.username, ['text'], [], checkVisibility);
    if (usernameFields.some(input => elementsToCheck.includes(input))) {
      return DetectedFieldType.Username;
    }

    // Check if any of the elements is a password field
    const passwordField = this.findPasswordField(formWrapper as HTMLFormElement | null);
    if ((passwordField.primary && elementsToCheck.includes(passwordField.primary)) ||
        (passwordField.confirm && elementsToCheck.includes(passwordField.confirm))) {
      return DetectedFieldType.Password;
    }

    // Check if any of the elements is an email field
    const emailFields = this.findAllInputFields(formWrapper as HTMLFormElement | null, CombinedFieldPatterns.email, ['text', 'email'], [], checkVisibility);
    if (emailFields.some(input => elementsToCheck.includes(input))) {
      return DetectedFieldType.Email;
    }

    // Check if any of the elements is a TOTP field
    const totpField = this.findTotpField(formWrapper as HTMLFormElement | null);
    if (totpField && elementsToCheck.includes(totpField)) {
      return DetectedFieldType.Totp;
    }

    return null;
  }

  /**
   * Create a form entry.
   */
  private detectFormFields(wrapper: HTMLElement | null): FormFields {
    // Keep track of detected fields to prevent overlap
    const detectedFields: HTMLInputElement[] = [];

    /*
     * If the user clicked on a field, skip visibility checks for all fields in the form.
     * This handles forms with transition animations where fields start with opacity:0
     * but become visible on interaction.
     */
    const checkVisibility = this.clickedElement === null;

    // Find fields in priority order (most specific to least specific).
    const emailFields = this.findEmailField(wrapper as HTMLFormElement | null, checkVisibility);
    if (emailFields.primary) {
      detectedFields.push(emailFields.primary);
    }
    if (emailFields.confirm) {
      detectedFields.push(emailFields.confirm);
    }

    const passwordFields = this.findPasswordField(wrapper as HTMLFormElement | null, checkVisibility);
    if (passwordFields.primary) {
      detectedFields.push(passwordFields.primary);
    }
    if (passwordFields.confirm) {
      detectedFields.push(passwordFields.confirm);
    }

    const usernameField = this.findInputField(wrapper as HTMLFormElement | null, CombinedFieldPatterns.username, ['text'], detectedFields, checkVisibility);
    if (usernameField) {
      detectedFields.push(usernameField);
    }

    const fullNameField = this.findInputField(wrapper as HTMLFormElement | null, CombinedFieldPatterns.fullName, ['text'], detectedFields, checkVisibility);
    if (fullNameField) {
      detectedFields.push(fullNameField);
    }

    const lastNameField = this.findInputField(wrapper as HTMLFormElement | null, CombinedFieldPatterns.lastName, ['text'], detectedFields, checkVisibility);
    if (lastNameField) {
      detectedFields.push(lastNameField);
    }

    /*
     * For login forms (username + password WITHOUT email or confirmation fields),
     * skip firstName detection to avoid matching session fields or other inputs.
     * If there's an email field alongside username, it's likely a registration form.
     */
    const isLikelyLoginForm = usernameField && passwordFields.primary &&
                               !emailFields.primary &&
                               !emailFields.confirm && !passwordFields.confirm;

    const firstNameField = !isLikelyLoginForm ?
      this.findInputField(wrapper as HTMLFormElement | null, CombinedFieldPatterns.firstName, ['text'], detectedFields, checkVisibility) : null;
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

    const totpField = this.findTotpField(wrapper as HTMLFormElement | null);
    if (totpField) {
      detectedFields.push(totpField);
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
      genderField,
      totpField
    };
  }
}
