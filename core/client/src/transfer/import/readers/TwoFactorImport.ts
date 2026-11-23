import { ItemTypes, normalizeTotpAlgorithm, normalizeTotpDigits, normalizeTotpPeriod } from '@aliasvault/models/vault';

import { buildOtpAuthUri } from '../../../items/OtpAuthUri';
import { isBlank } from '../../shared/StringUtils';
import { UnsupportedOtpCodeError } from '../models/UnsupportedOtpCodeError';
import { sanitizeTotpSecretKey } from '../writers/TotpHelper';

import type { ImportedCredential } from '../models/ImportedCredential';

/*
 * Generic 2FA import methods reused by several 2FA importers.
 */

/**
 * A code as a 2FA app exports it.
 */
export type TwoFactorEntry = {
  /** The service name, usually the issuer. */
  name: string | null;
  /** The account the code is for. */
  account: string | null;
  note?: string | null;
  /** The code type. Defaults to TOTP when absent. */
  type: string | null;
  secret: string | null;
  algorithm: string | null;
  digits: number | null;
  period: number | null;
};

/**
 * Convert a 2FA app code to a login item holding it.
 * @param entry - The code
 * @returns The credential
 * @throws {UnsupportedOtpCodeError} When AliasVault cannot generate the code.
 * @throws {Error} When the secret is not Base32.
 */
export function convertTwoFactorEntry(entry: TwoFactorEntry): ImportedCredential {
  const type = (entry.type?.trim() || 'TOTP').toUpperCase();
  if (type !== 'TOTP') {
    throw new UnsupportedOtpCodeError(`${type} codes are not supported, only TOTP.`);
  }

  const algorithm = (entry.algorithm?.trim() || 'SHA1').toUpperCase();
  const digits = entry.digits ?? 6;
  const period = entry.period ?? 30;
  if (normalizeTotpAlgorithm(algorithm) !== algorithm || normalizeTotpDigits(digits) !== digits || normalizeTotpPeriod(period) !== period) {
    throw new UnsupportedOtpCodeError(`TOTP codes with ${algorithm}, ${digits} digits and a ${period} second period are not supported.`);
  }

  const secret = buildOtpAuthUri('', entry.secret?.trim() ?? '', '', { Algorithm: algorithm, Digits: digits, Period: period });
  sanitizeTotpSecretKey(secret);

  const name = entry.name?.trim() ?? '';
  const account = entry.account?.trim() ?? '';
  return {
    ServiceName: name || account,
    Username: account || null,
    Notes: isBlank(entry.note) ? null : entry.note,
    TwoFactorSecret: secret,
    ItemType: ItemTypes.Login,
  };
}
