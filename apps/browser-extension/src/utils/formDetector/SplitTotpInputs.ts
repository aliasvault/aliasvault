/** How many ancestors of the clicked box are searched for the rest of the group. */
const MAX_ANCESTOR_DEPTH = 5;

/** Input types a single-character code box can have. */
const SPLIT_BOX_TYPES = new Set(['text', 'tel', 'number', 'password']);

/** Most boxes a split code group can have (TOTP codes are 6 to 8 digits). */
const MAX_SPLIT_BOXES = 8;

/**
 * Whether an input is a visible single-character box, as used by split TOTP forms.
 */
export function isSplitTotpBox(input: HTMLInputElement): boolean {
  if (input.maxLength !== 1 || input.hidden || input.disabled || !SPLIT_BOX_TYPES.has(input.type?.toLowerCase())) {
    return false;
  }

  const style = input.ownerDocument.defaultView?.getComputedStyle(input);
  return style?.display !== 'none' && style?.visibility !== 'hidden';
}

/**
 * Find the split TOTP boxes that together hold a code of `codeLength` characters, in document order.
 */
export function findSplitTotpInputs(input: HTMLInputElement, codeLength: number): HTMLInputElement[] | null {
  if (!isSplitTotpBox(input)) {
    return null;
  }

  /*
   * Walk up until an ancestor holds exactly `codeLength` boxes. Boxes are often wrapped one per
   * element (or grouped 3 + 3), so the group only shows up a few levels up; stop once an ancestor
   * holds more boxes than the code has characters, as that is no longer a single code group.
   */
  let ancestor = input.parentElement;
  for (let depth = 0; ancestor && depth < MAX_ANCESTOR_DEPTH; depth++) {
    const boxes = Array.from(ancestor.querySelectorAll<HTMLInputElement>('input')).filter(isSplitTotpBox);
    if (boxes.length === codeLength) {
      return boxes;
    }
    if (boxes.length > codeLength) {
      return null;
    }
    ancestor = ancestor.parentElement;
  }

  return null;
}

/**
 * Whether two inputs are boxes of the same split TOTP group.
 */
export function isInSameSplitTotpGroup(a: HTMLInputElement, b: HTMLInputElement): boolean {
  if (a === b || !isSplitTotpBox(a) || !isSplitTotpBox(b)) {
    return a === b;
  }

  let ancestor = a.parentElement;
  for (let depth = 0; ancestor && depth < MAX_ANCESTOR_DEPTH; depth++) {
    if (ancestor.contains(b)) {
      return Array.from(ancestor.querySelectorAll<HTMLInputElement>('input')).filter(isSplitTotpBox).length <= MAX_SPLIT_BOXES;
    }
    ancestor = ancestor.parentElement;
  }

  return false;
}
