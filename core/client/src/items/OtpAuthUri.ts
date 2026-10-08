import { normalizeTotpAlgorithm, normalizeTotpDigits, normalizeTotpPeriod, TOTP_DEFAULT_ALGORITHM, TOTP_DEFAULT_DIGITS, TOTP_DEFAULT_PERIOD } from '@aliasvault/models/vault';

import type { TotpParameters } from './TotpUtility';

/**
 * Parsed `otpauth://totp/` URI components.
 */
export type OtpAuthUri = {
  /** URL-decoded path component, typically "Issuer:account". */
  label: string;
  /** The label without its "Issuer:" prefix (kept when it differs from the `issuer` parameter). */
  account: string;
  /** Base32 secret from the `secret` query parameter. */
  secret: string;
  /** Optional `issuer` query parameter. */
  issuer?: string;
  /** HMAC algorithm from the `algorithm` parameter, normalized. */
  algorithm: string;
  /** Code length from the `digits` parameter, normalized. */
  digits: number;
  /** Time step from the `period` parameter, normalized. */
  period: number;
};

/**
 * Whether the input is an `otpauth://totp/` URI rather than a bare secret (scheme compared case-insensitively).
 * @param input - The secret or URI
 */
export function isOtpAuthUri(input: string): boolean {
  return input.trim().toLowerCase().startsWith('otpauth://totp/');
}

/**
 * Parse an `otpauth://totp/` URI (https://github.com/google/google-authenticator/wiki/Key-Uri-Format). HOTP URIs are
 * rejected, the vault only stores TOTP codes. The Base32 alphabet of the secret is not validated here; callers do that.
 * @param uri - The URI
 * @returns The parsed components, or null when the input is not a TOTP otpauth URI carrying a secret
 */
export function parseOtpAuthUri(uri: string): OtpAuthUri | null {
  const trimmed = uri.trim();
  const prefix = 'otpauth://totp/';
  if (!isOtpAuthUri(trimmed)) {
    return null;
  }

  const rest = trimmed.slice(prefix.length);
  const queryIdx = rest.indexOf('?');
  const labelEncoded = queryIdx >= 0 ? rest.slice(0, queryIdx) : rest;
  const queryString = queryIdx >= 0 ? rest.slice(queryIdx + 1) : '';

  let label: string;
  try {
    label = decodeURIComponent(labelEncoded);
  } catch {
    label = labelEncoded;
  }

  const params = new URLSearchParams(queryString);
  const secret = params.get('secret');
  if (!secret) {
    return null;
  }

  const issuer = params.get('issuer');
  const issuerSeparator = label.indexOf(':');
  // The label prefix is the issuer only when no issuer parameter contradicts it; otherwise the colon belongs to the account.
  const labelPrefix = issuerSeparator >= 0 ? label.slice(0, issuerSeparator).trim() : null;
  const prefixIsIssuer = labelPrefix !== null && (!issuer?.trim() || labelPrefix.toLowerCase() === issuer.trim().toLowerCase());
  return {
    label,
    account: prefixIsIssuer ? label.slice(issuerSeparator + 1).trim() : label,
    secret,
    ...(issuer ? { issuer } : {}),
    algorithm: normalizeTotpAlgorithm(params.get('algorithm')),
    digits: normalizeTotpDigits(params.get('digits')),
    period: normalizeTotpPeriod(params.get('period')),
  };
}

/**
 * The name for a code imported from an otpauth URI: "Issuer: account" when the URI names an issuer, else the account.
 * @param parsed - The parsed URI
 */
export function otpAuthDisplayName(parsed: OtpAuthUri): string {
  const issuer = parsed.issuer?.trim() ?? '';
  if (issuer.length === 0) {
    return parsed.account;
  }
  return parsed.account.length > 0 ? `${issuer}: ${parsed.account}` : issuer;
}

/**
 * Serialize a TOTP code back to an `otpauth://` URI. Non-default parameters are written out so a
 * scanned QR reproduces the same codes.
 *
 * @param label - URL-encoded label, typically "Issuer:account"
 * @param secretKey - Base32 secret
 * @param issuer - Issuer name
 * @param parameters - Stored algorithm/digits/period
 * @returns The otpauth:// URI
 */
export function buildOtpAuthUri(label: string, secretKey: string, issuer: string, parameters?: TotpParameters): string {
  const algorithm = normalizeTotpAlgorithm(parameters?.Algorithm);
  const digits = normalizeTotpDigits(parameters?.Digits);
  const period = normalizeTotpPeriod(parameters?.Period);

  let uri = `otpauth://totp/${label}?secret=${secretKey}&issuer=${encodeURIComponent(issuer)}`;
  if (algorithm !== TOTP_DEFAULT_ALGORITHM) {
    uri += `&algorithm=${algorithm}`;
  }
  if (digits !== TOTP_DEFAULT_DIGITS) {
    uri += `&digits=${digits}`;
  }
  if (period !== TOTP_DEFAULT_PERIOD) {
    uri += `&period=${period}`;
  }
  return uri;
}

/**
 * A TOTP code as entered in an editor or import: the Base32 secret, the name and its RFC 6238 parameters.
 */
export type TotpEntry = {
  secretKey: string;
  name: string;
  algorithm: string;
  digits: number;
  period: number;
};

/**
 * The advanced fields of a TOTP editor. Period is the raw text of its number input.
 */
export type TotpAdvancedValues = {
  algorithm: string;
  digits: number;
  period: string;
};

/**
 * The advanced field values for stored parameters, or the RFC 6238 defaults.
 * @param parameters - Stored algorithm/digits/period
 */
export function totpAdvancedValues(parameters?: TotpParameters): TotpAdvancedValues {
  return {
    algorithm: normalizeTotpAlgorithm(parameters?.Algorithm),
    digits: normalizeTotpDigits(parameters?.Digits),
    period: String(normalizeTotpPeriod(parameters?.Period)),
  };
}

/**
 * The normalized parameters for the advanced field values, falling back to the defaults for anything unusable.
 * @param advanced - The advanced field values
 */
export function totpParametersFrom(advanced: TotpAdvancedValues): Required<TotpParameters> {
  return { Algorithm: normalizeTotpAlgorithm(advanced.algorithm), Digits: normalizeTotpDigits(advanced.digits), Period: normalizeTotpPeriod(advanced.period) };
}

/**
 * Resolve a bare Base32 secret or an `otpauth://totp/` URI to a TOTP entry. A URI supplies its own parameters and, when
 * `nameInput` is blank, the name; `advanced` (picked by hand) overrides both the URI and the defaults.
 * @param secretInput - The bare secret or otpauth URI
 * @param nameInput - The name entered by the user, may be blank
 * @param advanced - Parameters picked by hand
 * @returns The entry, or null when the input holds no valid Base32 secret
 */
export function resolveTotpEntry(secretInput: string, nameInput: string, advanced?: TotpAdvancedValues): TotpEntry | null {
  let secretKey = secretInput.trim();
  let name = nameInput.trim();
  let algorithm = TOTP_DEFAULT_ALGORITHM;
  let digits = TOTP_DEFAULT_DIGITS;
  let period = TOTP_DEFAULT_PERIOD;

  if (isOtpAuthUri(secretKey)) {
    const parsed = parseOtpAuthUri(secretKey);
    if (!parsed) {
      return null;
    }
    secretKey = parsed.secret;
    ({ algorithm, digits, period } = parsed);
    if (name.length === 0) {
      name = otpAuthDisplayName(parsed);
    }
  }

  secretKey = secretKey.replace(/\s/g, '');
  if (!/^[A-Z2-7]+=*$/i.test(secretKey)) {
    return null;
  }

  if (advanced) {
    const parameters = totpParametersFrom(advanced);
    return { secretKey, name, algorithm: parameters.Algorithm, digits: parameters.Digits, period: parameters.Period };
  }
  return { secretKey, name, algorithm, digits, period };
}

/**
 * Whether any of the parameters differs from the RFC 6238 defaults, so an editor can open its advanced section.
 * @param parameters - Stored algorithm/digits/period
 */
export function hasCustomTotpParameters(parameters?: TotpParameters): boolean {
  return normalizeTotpAlgorithm(parameters?.Algorithm) !== TOTP_DEFAULT_ALGORITHM
    || normalizeTotpDigits(parameters?.Digits) !== TOTP_DEFAULT_DIGITS
    || normalizeTotpPeriod(parameters?.Period) !== TOTP_DEFAULT_PERIOD;
}
