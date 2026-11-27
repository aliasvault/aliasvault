import type { TranslationKey } from '@aliasvault/i18n';

/**
 * A custom HTTP header sent with every request to a self-hosted server, e.g. for a reverse proxy that checks for it.
 */
export type ProxyHeader = {
  name: string;
  value: string;
};

/**
 * Characters allowed in an HTTP header name (RFC 9110 token).
 */
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * Characters allowed in a header value that fetch accepts: visible Latin-1 characters, spaces and tabs.
 */
const HEADER_VALUE_PATTERN = /^[\t\x20-\x7E\x80-\xFF]*$/;

/**
 * The headers AliasVault sets on its own requests (lowercase), which a custom header must not replace.
 */
const RESERVED_HEADER_NAMES = ['authorization', 'content-type', 'x-aliasvault-client', 'x-aliasvault-appinstanceid'];

/**
 * Whether a header name conflicts with the headers AliasVault sets itself.
 */
function isReservedHeaderName(name: string): boolean {
  return RESERVED_HEADER_NAMES.includes(name.trim().toLowerCase());
}

/**
 * Whether a header name can be sent: a valid HTTP header name that AliasVault does not set itself.
 */
function isValidHeaderName(name: string): boolean {
  const trimmed = name.trim();
  return HEADER_NAME_PATTERN.test(trimmed) && !isReservedHeaderName(trimmed);
}

/**
 * The message for a header name that cannot be sent, or undefined when it can or is still empty.
 */
export function headerNameError(name: string): TranslationKey | undefined {
  const trimmed = name.trim();
  if (trimmed === '') {
    return undefined;
  }
  if (!HEADER_NAME_PATTERN.test(trimmed)) {
    return 'app.loginSettings.headerNameInvalid';
  }
  return isReservedHeaderName(trimmed) ? 'app.loginSettings.headerNameReserved' : undefined;
}

/**
 * The headers worth storing: trimmed, without entries that are empty, reserved or not valid HTTP headers.
 */
export function cleanProxyHeaders(headers: readonly ProxyHeader[]): ProxyHeader[] {
  return headers
    .map(header => ({ name: header.name.trim(), value: header.value.trim() }))
    .filter(header => header.value.length > 0 && isValidHeaderName(header.name) && HEADER_VALUE_PATTERN.test(header.value));
}

/**
 * Parse stored headers into the name-to-value map sent with each request; anything malformed is skipped.
 */
export function toRequestHeaders(stored: unknown): Record<string, string> {
  if (!Array.isArray(stored)) {
    return {};
  }
  const entries = stored.filter((entry): entry is ProxyHeader => typeof entry?.name === 'string' && typeof entry?.value === 'string');
  return Object.fromEntries(cleanProxyHeaders(entries).map(header => [header.name, header.value]));
}
