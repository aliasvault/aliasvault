/**
 * What an email's HTML body may contain when shown in a viewer, independent of the sanitizer library.
 */

/**
 * Elements kept in a displayed email.
 */
export const EMAIL_ALLOWED_TAGS = [
  'div', 'span', 'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'a', 'img',
  'b', 'i', 'u', 's', 'strike', 'strong', 'em', 'small', 'sub', 'sup',
  'blockquote', 'pre', 'code',
  'font', 'center',
];

/**
 * Attributes kept on any allowed element.
 */
export const EMAIL_ALLOWED_ATTRIBUTES = [
  'style', 'class', 'id',
  'width', 'height', 'align', 'valign',
  'bgcolor', 'color', 'border',
  'cellpadding', 'cellspacing', 'colspan', 'rowspan',
  'face', 'size',
  'href', 'target', 'rel',
  'src', 'alt', 'title',
];

/**
 * Elements always removed, even if a future edit adds them to the allowed list.
 */
export const EMAIL_FORBIDDEN_TAGS = [
  'script', 'object', 'embed', 'iframe', 'frame', 'frameset',
  'form', 'input', 'button', 'textarea', 'select', 'option',
  'link', 'meta', 'base', 'applet',
];

/**
 * Event handler attributes always removed, as a backstop to the allowed list.
 */
export const EMAIL_FORBIDDEN_ATTRIBUTES = [
  'onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout',
  'onfocus', 'onblur', 'onchange', 'onsubmit', 'onreset', 'onkeydown',
  'onkeyup', 'onkeypress', 'ondblclick', 'oncontextmenu', 'onmousedown',
  'onmouseup', 'onmousemove', 'ondrag', 'ondrop',
];
