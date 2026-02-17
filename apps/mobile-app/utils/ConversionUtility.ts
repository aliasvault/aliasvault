import sanitizeHtml from 'sanitize-html';

/**
 * sanitize-html configuration for email viewing.
 * Allows safe HTML elements for email display while blocking XSS vectors.
 * Note: Using sanitize-html instead of DOMPurify because React Native
 * doesn't have a DOM environment that DOMPurify requires.
 */
const EMAIL_SANITIZER_CONFIG: sanitizeHtml.IOptions = {
  // Disable style parsing as it requires PostCSS which doesn't work in React Native
  // See: https://github.com/apostrophecms/sanitize-html/issues/547
  parseStyleAttributes: false,
  allowedTags: [
    'div', 'span', 'p', 'br', 'hr',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'a', 'img',
    'b', 'i', 'u', 's', 'strike', 'strong', 'em', 'small', 'sub', 'sup',
    'blockquote', 'pre', 'code',
    'font', 'center'
  ],
  allowedAttributes: {
    '*': ['style', 'class', 'id'],
    'table': ['width', 'height', 'align', 'valign', 'bgcolor', 'border', 'cellpadding', 'cellspacing'],
    'tr': ['align', 'valign', 'bgcolor'],
    'th': ['width', 'height', 'align', 'valign', 'bgcolor', 'colspan', 'rowspan'],
    'td': ['width', 'height', 'align', 'valign', 'bgcolor', 'colspan', 'rowspan'],
    'a': ['href', 'target', 'rel'],
    'img': ['src', 'alt', 'title', 'width', 'height'],
    'font': ['color', 'face', 'size']
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  // Disable data: URIs for security (can be used for XSS)
  allowedSchemesByTag: {
    img: ['http', 'https'],
    a: ['http', 'https', 'mailto']
  }
};

/**
 * Utility class for conversion operations.
 * TODO: make this a shared utility class in root /core/ folder so we can reuse it between
 * browser extension/mobile app and possibly WASM client.
 */
class ConversionUtility {

  /**
   * Sanitizes HTML content for safe display in email viewers.
   * Removes all script tags, event handlers, and other XSS attack vectors.
   * @param html The HTML content to sanitize.
   * @returns Sanitized HTML safe for display.
   */
  public sanitizeHtmlForEmailViewing(html: string): string {
    if (!html || html.trim() === '') {
      return html;
    }

    try {
      return sanitizeHtml(html, EMAIL_SANITIZER_CONFIG);
    } catch (ex) {
      console.error(`Error in sanitizeHtmlForEmailViewing: ${ex instanceof Error ? ex.message : String(ex)}`);
      // Return empty string on error to prevent potential XSS
      return '';
    }
  }

  /**
   * Normalize a username by converting it to lowercase and trimming whitespace.
   * @param username The username to normalize.
   * @returns The normalized username.
   */
  public normalizeUsername(username: string): string {
    return username.toLowerCase().trim();
  }
}

export default new ConversionUtility();
