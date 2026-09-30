import { isRelatedOriginAllowed, isRpIdAllowedForHost } from '@aliasvault/client/rust/RustCore';

const CACHE_TTL_MS = 5 * 60 * 1000;
const FAILED_FETCH_TTL_MS = 15 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_CACHE_ENTRIES = 100;
const relatedOriginsCache = new Map<string, { origins: string[]; expiresAt: number }>();

/**
 * Returns whether a page may use `rpId` as its WebAuthn RP ID.
 * @param rpId - Claimed RP ID.
 * @param callerOrigin - Origin of the requesting page.
 * @param callerHost - Hostname of the requesting page.
 * @returns True if the RP ID is allowed.
 */
export async function isRpIdAllowedForCaller(rpId: string, callerOrigin: string, callerHost: string): Promise<boolean> {
  if (await isRpIdAllowedForHost(rpId, callerHost)) {
    return true;
  }

  const origins = await getRelatedOrigins(rpId);
  return origins.length > 0 && await isRelatedOriginAllowed(callerOrigin, origins);
}

/**
 * Origins listed in `/.well-known/webauthn` for `rpId`, or an empty list.
 * @param rpId - Claimed RP ID.
 * @returns Normalized origins.
 */
async function getRelatedOrigins(rpId: string): Promise<string[]> {
  const url = getWellKnownUrl(rpId);
  if (!url) {
    return [];
  }

  const cached = relatedOriginsCache.get(url.hostname);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.origins;
  }

  const origins = await fetchRelatedOrigins(url);
  const ttl = origins === null ? FAILED_FETCH_TTL_MS : CACHE_TTL_MS;
  relatedOriginsCache.delete(url.hostname);
  relatedOriginsCache.set(url.hostname, { origins: origins ?? [], expiresAt: Date.now() + ttl });
  if (relatedOriginsCache.size > MAX_CACHE_ENTRIES) {
    relatedOriginsCache.delete(relatedOriginsCache.keys().next().value as string);
  }
  return origins ?? [];
}

/**
 * Well-known WebAuthn URL for `rpId`, or null if `rpId` is not a domain name.
 * @param rpId - Claimed RP ID.
 * @returns The URL, or null.
 */
function getWellKnownUrl(rpId: string): URL | null {
  const host = rpId.trim().toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+\.?$/.test(host) || /^[\d.]+$/.test(host)) {
    return null;
  }

  try {
    const url = new URL(`https://${host}/.well-known/webauthn`);
    return url.hostname === host && url.port === '' ? url : null;
  } catch {
    return null;
  }
}

/**
 * Fetches related origins from `url`.
 * @param url - Well-known WebAuthn URL.
 * @returns Normalized origins, empty when the RP has no valid list, or null when the fetch failed.
 */
async function fetchRelatedOrigins(url: URL): Promise<string[] | null> {
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return null;
  }

  if (response.status >= 500) {
    return null;
  }

  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (response.status !== 200 || contentType !== 'application/json' || contentLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    return [];
  }

  let text: string | null;
  try {
    text = await readLimitedText(response);
  } catch {
    return null;
  }
  if (text === null) {
    return [];
  }

  try {
    const origins: unknown = (JSON.parse(text) as { origins?: unknown })?.origins;
    return Array.isArray(origins) ? origins.flatMap(normalizeOrigin) : [];
  } catch {
    return [];
  }
}

/**
 * Reads the response body as text, stopping as soon as it grows past `MAX_RESPONSE_BYTES`.
 * @param response - The response to read.
 * @returns The body, or null when it is too large.
 */
async function readLimitedText(response: Response): Promise<string | null> {
  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * The serialized origin of an entry in the `origins` list, as a list of zero or one.
 * @param origin - Entry from the list.
 * @returns The origin, or an empty list when the entry is not a URL.
 */
function normalizeOrigin(origin: unknown): string[] {
  if (typeof origin !== 'string') {
    return [];
  }
  try {
    return [new URL(origin).origin];
  } catch {
    return [];
  }
}
