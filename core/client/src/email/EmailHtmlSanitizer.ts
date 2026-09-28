import DOMPurify, { type Config, type DOMPurify as DOMPurifyInstance } from 'dompurify';

import { logExpected } from '../utilities/Diagnostics';

import { EMAIL_ALLOWED_ATTRIBUTES, EMAIL_ALLOWED_TAGS, EMAIL_FORBIDDEN_ATTRIBUTES, EMAIL_FORBIDDEN_TAGS } from './EmailHtmlPolicy';

/**
 * DOMPurify options built from the shared email HTML policy.
 */
const SANITIZER_CONFIG: Config = {
  ALLOWED_TAGS: EMAIL_ALLOWED_TAGS,
  ALLOWED_ATTR: EMAIL_ALLOWED_ATTRIBUTES,
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: EMAIL_FORBIDDEN_TAGS,
  FORBID_ATTR: EMAIL_FORBIDDEN_ATTRIBUTES,
};

/**
 * Own DOMPurify instance, so the link hook below never touches other DOMPurify users. Created on first use.
 */
let purifier: DOMPurifyInstance | null = null;

/**
 * The email sanitizer, which also makes every link open in a new tab within the same pass.
 */
function getPurifier(): DOMPurifyInstance {
  if (purifier) {
    return purifier;
  }
  purifier = DOMPurify(window);
  purifier.addHook('afterSanitizeAttributes', node => {
    if (node.nodeName !== 'A' || !node.hasAttribute('href')) {
      return;
    }
    node.setAttribute('target', '_blank');
    const rel = new Set((node.getAttribute('rel') ?? '').split(' ').filter(value => value.trim() !== ''));
    rel.add('noopener');
    rel.add('noreferrer');
    node.setAttribute('rel', Array.from(rel).join(' '));
  });
  return purifier;
}

/**
 * Sanitize an email's HTML body for display and make its links open in a new tab.
 * @param html - the HTML body of the email
 * @returns HTML safe for display, or an empty string when sanitizing fails
 */
export function sanitizeEmailHtml(html: string): string {
  if (!html || html.trim() === '') {
    return html;
  }

  try {
    return getPurifier().sanitize(html, SANITIZER_CONFIG);
  } catch (error) {
    logExpected('[Email] Sanitizing the email HTML failed', error);
    // Show nothing rather than risk showing unsanitized HTML.
    return '';
  }
}
