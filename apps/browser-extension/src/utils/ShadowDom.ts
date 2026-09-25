/**
 * Helpers for working with pages that render (part of) their content inside open shadow roots.
 */

import { devLog } from '@/utils/devLogger/DevLogger';

/**
 * Upper bound on the number of shadow roots a single deep query descends into, to limit scans to
 * sane max values. Component-heavy pages are known to run well into the hundreds, therefore we
 * set this to a high value.
 */
const MAX_SHADOW_ROOTS = 2000;

/**
 * Get the shadow root a node lives in, or null when it is in the normal DOM.
 * @param node - The node to resolve the root for.
 * @returns The containing ShadowRoot, or null when the node is not inside a shadow root.
 */
export function getContainingShadowRoot(node: Node | null): ShadowRoot | null {
  const root = node?.getRootNode() as ShadowRoot | undefined;
  return root?.host ? root : null;
}

/**
 * Get the root node (Document or ShadowRoot) a node belongs to.
 * @param node - The node to resolve the root for.
 * @returns The node's Document or ShadowRoot.
 */
export function getQueryRoot(node: Node): Document | ShadowRoot {
  return node.getRootNode() as Document | ShadowRoot;
}

/**
 * Like `Element.parentElement`, but hops from the top of a shadow root to its host element
 * instead of returning null.
 * @param element - The element to get the parent of.
 * @returns The parent element in the composed tree, or null at the top of the root node.
 */
export function getComposedParentElement(element: Element | null): Element | null {
  if (!element) {
    return null;
  }

  if (element.parentElement) {
    return element.parentElement;
  }

  return getContainingShadowRoot(element)?.host ?? null;
}

/**
 * Collect the shadow hosts an element sits inside, innermost first.
 * @param element - The element to resolve the hosts for.
 * @param maxDepth - Maximum number of hosts to walk up to.
 * @returns The shadow hosts wrapping the element, innermost first; empty when it is not in a shadow tree.
 */
export function getShadowHostChain(element: Element | null, maxDepth: number = 3): Element[] {
  const hosts: Element[] = [];
  let current: Element | null = element;

  while (current && hosts.length < maxDepth) {
    const host = getContainingShadowRoot(current)?.host ?? null;
    if (!host) {
      break;
    }

    hosts.push(host);
    current = host;
  }

  return hosts;
}

/**
 * Similar to `Element.closest()`, but continues the search at the shadow host when the element's own shadow root contains no match.
 * @param element - The element to start searching from.
 * @param selector - The CSS selector to match against.
 * @returns The nearest matching ancestor in the composed tree, or null when there is none.
 */
export function closestAcrossShadow(element: Element | null, selector: string): HTMLElement | null {
  let current: Element | null = element;

  while (current) {
    const match = current.closest(selector) as HTMLElement | null;
    if (match) {
      return match;
    }
    current = getContainingShadowRoot(current)?.host ?? null;
  }

  return null;
}

/**
 * Similar to `Node.contains()`, but treats a shadow host as containing its shadow root.
 * @param ancestor - The candidate ancestor element.
 * @param node - The node to test.
 * @returns True when node is ancestor itself or sits below it in the composed tree.
 */
export function composedContains(ancestor: Element | null, node: Node | null): boolean {
  if (!ancestor || !node) {
    return false;
  }

  let current: Node | null = node;
  while (current) {
    if (current === ancestor) {
      return true;
    }

    // At the top of a shadow tree parentNode is the ShadowRoot itself — continue at its host.
    const parent = current.parentNode as (Node & { host?: Element }) | null;
    current = parent ? (parent.host ?? parent) : null;
  }

  return false;
}

/**
 * Resolve the element a focus/pointer event really originated from, looking through shadow
 * boundaries. Events crossing an open shadow root are retargeted to the host, so `event.target`
 * alone would report the custom element instead of the input the user actually focused.
 * @param event - The event to resolve the target for.
 * @returns The deepest element in the event's composed path, falling back to `event.target`.
 */
export function getDeepEventTarget(event: Event): Element | null {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  const deepest = path[0] as Element | undefined;

  // Node.ELEMENT_NODE — duck-typed so it also holds for nodes from another realm.
  if (deepest && deepest.nodeType === 1) {
    return deepest;
  }

  return event.target as Element | null;
}

/**
 * Resolve the focused element, descending through open shadow roots. `document.activeElement`
 * only reports the outermost host for content inside a shadow tree.
 * @param documentOrRoot - The document (or shadow root) to start from.
 * @returns The deepest focused element, or null when nothing is focused.
 */
export function getDeepActiveElement(documentOrRoot: Document | ShadowRoot): Element | null {
  let active = documentOrRoot.activeElement;

  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }

  return active;
}

/**
 * Collect every open shadow root reachable from the given root.
 * @param root - The root to scan.
 * @returns The reachable shadow roots, outermost first.
 */
export function collectShadowRoots(root: Document | ShadowRoot | Element): ShadowRoot[] {
  const shadowRoots: ShadowRoot[] = [];
  const seen = new Set<ShadowRoot>();
  const queue: (Document | ShadowRoot | Element)[] = [root];

  while (queue.length > 0 && shadowRoots.length < MAX_SHADOW_ROOTS) {
    const current = queue.shift()!;

    for (const element of Array.from(current.querySelectorAll<HTMLElement>('*'))) {
      const shadowRoot = element.shadowRoot;
      if (shadowRoot && !seen.has(shadowRoot)) {
        seen.add(shadowRoot);
        shadowRoots.push(shadowRoot);
        queue.push(shadowRoot);

        if (shadowRoots.length >= MAX_SHADOW_ROOTS) {
          devLog(`[ShadowDom] Shadow root scan truncated at ${MAX_SHADOW_ROOTS} roots; deeper components are not visible to detection.`);
          break;
        }
      }
    }
  }

  return shadowRoots;
}

/**
 * Similar to `querySelectorAll`, but also descends into open shadow roots.
 * @param root - The root to query from.
 * @param selector - The CSS selector to match.
 * @returns The matching elements from the normal DOM and every reachable shadow root.
 */
export function queryAllDeep<T extends Element>(root: Document | ShadowRoot | Element, selector: string): T[] {
  const results: T[] = Array.from(root.querySelectorAll<T>(selector));

  for (const shadowRoot of collectShadowRoots(root)) {
    results.push(...Array.from(shadowRoot.querySelectorAll<T>(selector)));
  }

  return results;
}

/**
 * Like `document.getElementById`, but also searches open shadow roots. IDs inside a shadow tree
 * are scoped to that tree, so the same id may legitimately exist more than once; the normal DOM
 * match wins, then shadow trees in document order.
 * @param documentOrRoot - The document to search.
 * @param elementId - The id to look for.
 * @returns The first matching element, or null when there is none.
 */
export function getDeepElementById(documentOrRoot: Document | ShadowRoot, elementId: string): HTMLElement | null {
  const lightMatch = documentOrRoot.getElementById(elementId) as HTMLElement | null;
  if (lightMatch) {
    return lightMatch;
  }

  for (const shadowRoot of collectShadowRoots(documentOrRoot)) {
    const match = shadowRoot.getElementById(elementId);
    if (match) {
      return match as HTMLElement;
    }
  }

  return null;
}
