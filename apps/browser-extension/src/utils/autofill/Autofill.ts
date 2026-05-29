/**
 * Helpers for deciding whether AliasVault's autofill UI is allowed for a given
 * DOM element. The web app uses `av-disable="true"` on its `<body>` to opt out
 * of extension autofill globally, and individual subtrees can opt back in with
 * `av-enable="true"` so the extension can fill the master-password login form
 * even when the rest of the app stays disabled. A second flag,
 * `av-suppress-save="true"`, can be combined with `av-enable` to keep autofill
 * available for matching credentials while hiding the "save this login" and
 * "create new" affordances — useful on pages where storing the credential
 * shouldn't be encouraged (e.g. AliasVault's own login form).
 */

/**
 * Walk up the DOM from the given element and determine whether AliasVault
 * autofill is allowed. The nearest ancestor (or the element itself) carrying
 * an `av-enable="true"` or `av-disable="true"` attribute decides — closer
 * `av-enable` overrides a further-up `av-disable`. When neither attribute is
 * present anywhere up the chain, autofill is allowed.
 * @param element - The element to start walking from (typically the focused input).
 * @returns True when autofill is allowed for this element.
 */
export function isAvAutofillAllowed(element: Element | null): boolean {
  let current: Element | null = element;
  while (current) {
    if (current.getAttribute('av-enable') === 'true') {
      return true;
    }
    if (current.getAttribute('av-disable') === 'true') {
      return false;
    }
    current = current.parentElement;
  }
  return true;
}

/**
 * Walk up the DOM from the given element and determine whether save-related
 * affordances should be suppressed. Closest ancestor wins — an explicit
 * `av-suppress-save="false"` deeper in the tree overrides a `="true"` higher
 * up. Defaults to false (not suppressed) when the attribute is absent.
 *
 * When this returns true, callers should:
 *   - skip the "save this login" capture/prompt entirely;
 *   - skip showing the autofill popup unless a matching credential already exists
 *     (so the user isn't nudged toward creating a new credential here).
 * @param element - The element to start walking from.
 * @returns True when save-related affordances should be suppressed.
 */
export function isAvSuppressSave(element: Element | null): boolean {
  let current: Element | null = element;
  while (current) {
    const value = current.getAttribute('av-suppress-save');
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    current = current.parentElement;
  }
  return false;
}
