import { normalizeTotpAlgorithm, normalizeTotpDigits, normalizeTotpPeriod, TOTP_DEFAULT_ALGORITHM, TOTP_DEFAULT_DIGITS, TOTP_DEFAULT_PERIOD } from '@aliasvault/models/vault';
import * as OTPAuth from 'otpauth';

/**
 * A TOTP secret with the name and the RFC 6238 parameters it was imported with.
 */
export type SanitizedTotpSecret = {
  secretKey: string;
  name: string | null;
  algorithm: string;
  digits: number;
  period: number;
};

/**
 * Sanitize a TOTP secret that may be given as an otpauth:// URI.
 * @param secretKey - The bare Base32 secret or an otpauth://totp/ URI
 * @param name - The name to use; derived from the URI's label and issuer when not provided
 * @returns The secret, name and parameters
 * @throws {Error} When the URI is malformed or the secret cannot generate a code.
 */
export function sanitizeTotpSecretKey(secretKey: string, name?: string | null): SanitizedTotpSecret {
  let secret = secretKey;
  let algorithm = TOTP_DEFAULT_ALGORITHM;
  let digits = TOTP_DEFAULT_DIGITS;
  let period = TOTP_DEFAULT_PERIOD;
  let resolvedName = name ?? null;

  if (secret.startsWith('otpauth://totp/')) {
    try {
      const rest = secret.substring('otpauth://totp/'.length);
      const queryIndex = rest.indexOf('?');
      const labelEncoded = queryIndex >= 0 ? rest.substring(0, queryIndex) : rest;
      const params = new URLSearchParams(queryIndex >= 0 ? rest.substring(queryIndex + 1) : '');

      const secretParam = params.get('secret');
      if (!secretParam) {
        throw new Error('Secret not found in URI');
      }
      secret = secretParam;

      algorithm = normalizeTotpAlgorithm(params.get('algorithm'));
      digits = normalizeTotpDigits(params.get('digits'));
      period = normalizeTotpPeriod(params.get('period'));

      if (!resolvedName || resolvedName.trim().length === 0) {
        // The label is everything after 'totp/' and before '?'.
        const label = decodeURIComponent(labelEncoded.replace(/\+/g, ' '));
        const issuer = params.get('issuer');

        // A label "issuer:account" is split only when the query carries no issuer, so account names with colons survive.
        if (label.includes(':') && (!issuer || issuer.trim().length === 0)) {
          resolvedName = label.substring(label.indexOf(':') + 1);
        } else {
          resolvedName = label;
        }

        if (issuer && issuer.trim().length > 0) {
          resolvedName = `${issuer}: ${resolvedName}`;
        }
      }
    } catch {
      throw new Error('Invalid TOTP URI format. Please check and try again.');
    }
  }

  // The secret must be valid, check by trying to generate a code.
  try {
    new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), algorithm, digits, period }).generate();
  } catch {
    throw new Error('Invalid secret key. Please check and try again.');
  }

  return { secretKey: secret, name: resolvedName, algorithm, digits, period };
}
