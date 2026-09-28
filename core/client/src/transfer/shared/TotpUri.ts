import { normalizeTotpAlgorithm, normalizeTotpDigits, normalizeTotpPeriod } from '@aliasvault/models/vault';

import type { TotpCodeEntity } from './VaultEntities';

/**
 * Format a TOTP code as an otpauth:// URI that the importer's `sanitizeTotpSecretKey` reads back with the same
 * name and parameters.
 *
 * @param totpCode - The TOTP code
 * @param blankLabel - The label to write when the code has no name
 * @returns The otpauth:// URI
 */
export function formatTotpUri(totpCode: Pick<TotpCodeEntity, 'Name' | 'SecretKey' | 'Algorithm' | 'Digits' | 'Period'>, blankLabel: string = ''): string {
  const name = (totpCode.Name ?? '').trim();
  const colonIndex = name.indexOf(':');
  const issuer = colonIndex > 0 ? name.substring(0, colonIndex).trim() : '';
  const label = issuer.length > 0 ? name.substring(colonIndex + 1).trim() : (name.length > 0 ? name : blankLabel);
  const params = new URLSearchParams({ secret: totpCode.SecretKey });
  if (issuer.length > 0) {
    params.set('issuer', issuer);
  }
  params.set('algorithm', normalizeTotpAlgorithm(totpCode.Algorithm));
  params.set('digits', String(normalizeTotpDigits(totpCode.Digits)));
  params.set('period', String(normalizeTotpPeriod(totpCode.Period)));
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}
