import { AppInfo } from './AppInfo';

/**
 * Path under which a default AliasVault install serves its API, relative to the server URL.
 */
const API_PATH = '/api';

/**
 * The self-hosted server fields shown in the login settings of the browser extension and mobile app.
 */
export type ServerUrlFields = {
  serverUrl: string;
  apiUrl: string;
  isCustomApiUrl: boolean;
};

/**
 * Translation keys of the validation errors of the server URL fields.
 */
export type ServerUrlErrors = {
  serverUrl?: string;
  apiUrl?: string;
};

/**
 * Trim whitespace and trailing slashes from a URL.
 */
function normalize(url: string | null | undefined): string {
  return (url ?? '').trim().replace(/\/+$/, '');
}

/**
 * Whether a value is an absolute http(s) URL.
 */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The default API URL of a server URL (server URL + /api), or an empty string for an empty server URL.
 */
export function apiUrlFromServerUrl(serverUrl: string): string {
  const base = normalize(serverUrl);
  return base ? base + API_PATH : '';
}

/**
 * The server URL of an API URL that ends with /api, or an empty string when it does not.
 */
export function serverUrlFromApiUrl(apiUrl: string): string {
  const base = normalize(apiUrl);
  return base.endsWith(API_PATH) ? base.slice(0, -API_PATH.length) : '';
}

/**
 * A stored URL without trailing slashes, or an empty string when it is the official server's URL.
 */
function selfHostedUrl(storedUrl: string | null | undefined, officialUrl: string): string {
  const url = normalize(storedUrl);
  return url === normalize(officialUrl) ? '' : url;
}

/**
 * Turn the stored API URL and client URL into the self-hosted settings fields; the official server's URLs count as not set.
 */
export function toServerUrlFields(storedApiUrl: string | null | undefined, storedClientUrl?: string | null): ServerUrlFields {
  const apiUrl = selfHostedUrl(storedApiUrl, AppInfo.DEFAULT_API_URL);
  /*
   * Setting only an API URL is supported, so there may be no client URL. The server URL is then derived from the API URL
   * as a best effort: when it ends with /api; otherwise it stays empty.
   */
  const serverUrl = selfHostedUrl(storedClientUrl, AppInfo.DEFAULT_CLIENT_URL) || serverUrlFromApiUrl(apiUrl);
  const defaultApiUrl = apiUrlFromServerUrl(serverUrl);
  return { serverUrl, apiUrl: apiUrl || defaultApiUrl, isCustomApiUrl: apiUrl !== '' && apiUrl !== defaultApiUrl };
}

/**
 * The fields after editing the server URL; an API URL that is not custom follows it.
 */
export function withServerUrl(fields: ServerUrlFields, serverUrl: string): ServerUrlFields {
  return { serverUrl, apiUrl: fields.isCustomApiUrl ? fields.apiUrl : apiUrlFromServerUrl(serverUrl), isCustomApiUrl: fields.isCustomApiUrl };
}

/**
 * The fields after editing the API URL; it is custom unless empty or equal to the server URL + /api.
 */
export function withApiUrl(fields: ServerUrlFields, apiUrl: string): ServerUrlFields {
  const value = normalize(apiUrl);
  return { serverUrl: fields.serverUrl, apiUrl, isCustomApiUrl: value !== '' && value !== apiUrlFromServerUrl(fields.serverUrl) };
}

/**
 * Validate the fields: a server URL or API URL is required, and each one filled in must be an http(s) URL.
 */
export function validateServerUrlFields(fields: ServerUrlFields): ServerUrlErrors {
  const errors: ServerUrlErrors = {};
  const serverUrl = normalize(fields.serverUrl);
  const apiUrl = normalize(fields.apiUrl);
  if (!serverUrl && !apiUrl) {
    errors.serverUrl = 'settings.validation.serverUrlRequired';
  } else if (serverUrl && !isHttpUrl(serverUrl)) {
    errors.serverUrl = 'settings.validation.serverUrlInvalid';
  }
  if (apiUrl && !isHttpUrl(apiUrl)) {
    errors.apiUrl = 'settings.validation.apiUrlInvalid';
  }
  return errors;
}

/**
 * The API URL and client URL to store for the fields; an empty API URL falls back to the server URL + /api.
 */
export function toStoredUrls(fields: ServerUrlFields): { apiUrl: string; clientUrl: string } {
  return { apiUrl: normalize(fields.apiUrl) || apiUrlFromServerUrl(fields.serverUrl), clientUrl: normalize(fields.serverUrl) };
}

/**
 * The web app URL to link to: the stored client URL, else the server URL of the API URL, else the official one.
 */
export function resolveClientUrl(storedApiUrl: string | null | undefined, storedClientUrl: string | null | undefined): string {
  return normalize(storedClientUrl) || serverUrlFromApiUrl(normalize(storedApiUrl)) || AppInfo.DEFAULT_CLIENT_URL;
}
