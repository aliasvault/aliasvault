import DOMPurify from 'dompurify';

/**
 * DOMPurify configuration for email viewing.
 * Allows safe HTML elements for email display while blocking XSS vectors.
 */
const EMAIL_SANITIZER_CONFIG = {
  ALLOWED_TAGS: [
    'div', 'span', 'p', 'br', 'hr',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'a', 'img',
    'b', 'i', 'u', 's', 'strike', 'strong', 'em', 'small', 'sub', 'sup',
    'blockquote', 'pre', 'code',
    'font', 'center'
  ],
  ALLOWED_ATTR: [
    'style', 'class', 'id',
    'width', 'height', 'align', 'valign',
    'bgcolor', 'color', 'border',
    'cellpadding', 'cellspacing', 'colspan', 'rowspan',
    'face', 'size',
    'href', 'target', 'rel',
    'src', 'alt', 'title'
  ],
  ALLOW_DATA_ATTR: false,
  ADD_ATTR: ['target'],
  FORBID_TAGS: ['script', 'object', 'embed', 'iframe', 'frame', 'frameset',
    'form', 'input', 'button', 'textarea', 'select', 'option',
    'link', 'meta', 'base', 'applet'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout',
    'onfocus', 'onblur', 'onchange', 'onsubmit', 'onreset', 'onkeydown',
    'onkeyup', 'onkeypress', 'ondblclick', 'oncontextmenu', 'onmousedown',
    'onmouseup', 'onmousemove', 'ondrag', 'ondrop']
};

/**
 * Utility class for conversion operations.
 * TODO: make this a shared utility class in root /core/ folder so we can reuse it between browser extension/mobile app
 * and possibly WASM client.
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
      return DOMPurify.sanitize(html, EMAIL_SANITIZER_CONFIG);
    } catch (ex) {
      console.error(`Error in sanitizeHtmlForEmailViewing: ${ex instanceof Error ? ex.message : String(ex)}`);
      // Return empty string on error to prevent potential XSS
      return '';
    }
  }

  /**
   * Sanitizes HTML content and converts anchor tags to open in a new tab.
   * This is a convenience method that combines sanitization with anchor tag conversion.
   * @param html The HTML content to process.
   * @returns Sanitized HTML with anchor tags configured to open in new tabs.
   */
  public sanitizeAndPrepareEmailHtml(html: string): string {
    if (!html || html.trim() === '') {
      return html;
    }

    // First sanitize to remove XSS vectors
    const sanitizedHtml = this.sanitizeHtmlForEmailViewing(html);

    // Then convert anchor tags to open in new tab
    return this.convertAnchorTagsToOpenInNewTab(sanitizedHtml);
  }

  /**
   * Convert all anchor tags to open in a new tab.
   * @param html HTML input.
   * @returns HTML with all anchor tags converted to open in a new tab when clicked on.
   *
   * Note: same implementation exists in c-sharp version in AliasVault.Shared.Utilities.ConversionUtility.cs
   */
  public convertAnchorTagsToOpenInNewTab(html: string): string {
    try {
      // Create a DOM parser
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Select all anchor tags with href attribute
      const anchors = doc.querySelectorAll('a[href]');

      if (anchors.length > 0) {
        anchors.forEach((anchor: Element) => {
          // Handle target attribute
          if (!anchor.hasAttribute('target') || anchor.getAttribute('target') !== '_blank') {
            anchor.setAttribute('target', '_blank');
          }

          // Handle rel attribute for security
          if (!anchor.hasAttribute('rel')) {
            anchor.setAttribute('rel', 'noopener noreferrer');
          } else {
            const relValue = anchor.getAttribute('rel') ?? '';
            const relValues = new Set(relValue.split(' ').filter(val => val.trim() !== ''));

            relValues.add('noopener');
            relValues.add('noreferrer');

            anchor.setAttribute('rel', Array.from(relValues).join(' '));
          }
        });
      }

      return doc.documentElement.outerHTML;
    } catch (ex) {
      // Log the exception
      console.error(`Error in convertAnchorTagsToOpenInNewTab: ${ex instanceof Error ? ex.message : String(ex)}`);

      // Return the original HTML if an error occurs
      return html;
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
