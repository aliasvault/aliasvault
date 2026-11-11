/**
 * Inline styles that undo the UA popover styles on the shadow host while it is in the top layer.
 */
const TOP_LAYER_HOST_STYLES: Record<string, string> = {
  position: 'fixed',
  inset: '0 auto auto 0',
  width: '0',
  height: '0',
  margin: '0',
  padding: '0',
  border: '0',
  overflow: 'visible',
  background: 'transparent',
};

/**
 * Get the composed-tree parent of `node`, crossing shadow root boundaries.
 */
function getComposedParent(node: Node): Node | null {
  if (node.parentNode instanceof ShadowRoot) {
    return node.parentNode.host;
  }
  return node.parentNode;
}

/**
 * Whether `element` is a modal dialog or an open popover, both of which render in the top layer.
 */
function isTopLayerElement(element: Element): boolean {
  for (const selector of ['dialog:modal', ':popover-open']) {
    try {
      if (element.matches(selector)) {
        return true;
      }
    } catch {
      // Unsupported selector.
    }
  }
  return false;
}

/**
 * Find the innermost top-layer element (modal dialog or open popover) that contains `node`.
 */
function findTopLayerAncestor(node: Node): Element | null {
  for (let current = getComposedParent(node); current; current = getComposedParent(current)) {
    if (current instanceof Element && isTopLayerElement(current)) {
      return current;
    }
  }
  return null;
}

/**
 * Move the extension UI into the modal dialog or popover holding `input`, or back to the document body otherwise.
 */
export function placeUiForInput(input: Element, container: HTMLElement): void {
  const root = container.getRootNode();
  if (!(root instanceof ShadowRoot)) {
    return;
  }

  const host = root.host as HTMLElement;
  const target = findTopLayerAncestor(input);

  if (!target) {
    if (host.hasAttribute('popover')) {
      hidePopover(host);
      host.removeAttribute('popover');
      for (const property of Object.keys(TOP_LAYER_HOST_STYLES)) {
        host.style.removeProperty(property);
      }
    }
    if (host.parentNode !== document.body && document.body) {
      document.body.appendChild(host);
    }
    return;
  }

  /*
   * A modal dialog renders above and makes inert everything outside it, so the host
   * moves inside it and is shown as a popover to render above it.
   */
  if (typeof host.showPopover !== 'function') {
    return;
  }

  if (host.parentNode !== target) {
    target.appendChild(host);
  }

  host.setAttribute('popover', 'manual');
  for (const [property, value] of Object.entries(TOP_LAYER_HOST_STYLES)) {
    host.style.setProperty(property, value, 'important');
  }

  // Re-show so the host is the topmost top-layer element, also when the dialog was reopened after it.
  hidePopover(host);
  try {
    host.showPopover();
  } catch {
    // Not connected or not a valid popover.
  }
}

/**
 * Hide `host` as a popover when it is open.
 */
function hidePopover(host: HTMLElement): void {
  try {
    if (host.matches(':popover-open')) {
      host.hidePopover();
    }
  } catch {
    // Unsupported selector or popover API.
  }
}
