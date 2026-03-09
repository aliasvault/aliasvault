import { createHash } from 'crypto';

export const ALIAS_DOMAIN = 'alias.id';

/**
 * Hash an alias using SHA-256: SHA-256("localPart@alias.id") -> 32 bytes.
 * Must produce identical output to browser extension's hashAlias() in aliasUtils.ts
 * which uses crypto.subtle.digest('SHA-256', ...).
 */
export function hashAlias(localPart: string, domain: string = ALIAS_DOMAIN): Uint8Array {
  const email = `${localPart}@${domain}`;
  const hash = createHash('sha256').update(email).digest();
  return new Uint8Array(hash);
}
