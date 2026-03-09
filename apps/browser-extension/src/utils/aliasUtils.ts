/**
 * Alias name validation, random generation, and hashing utilities.
 */

export const ALIAS_DOMAIN = 'alias.id';

const ALIAS_NAME_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const CONSECUTIVE_HYPHENS_REGEX = /--/;
const MIN_LENGTH = 3;
const MAX_LENGTH = 64;

const ADJECTIVES = [
  'zk', 'dark', 'fast', 'safe', 'calm', 'bold', 'cool', 'keen',
  'wise', 'free', 'true', 'pure', 'rare', 'shy', 'wild', 'warm',
];

const NOUNS = [
  'tiger', 'hawk', 'wolf', 'bear', 'fox', 'owl', 'lynx', 'seal',
  'crane', 'puma', 'raven', 'otter', 'eagle', 'heron', 'finch', 'bison',
];

export interface AliasValidation {
  valid: boolean;
  error?: string;
}

/**
 * Validate an alias name (local part before @alias.id).
 * Rules: 3-64 chars, lowercase alphanumeric + hyphen,
 * no leading/trailing hyphens, no consecutive hyphens.
 */
export function validateAliasName(name: string): AliasValidation {
  if (name.length < MIN_LENGTH) {
    return { valid: false, error: `Alias must be at least ${MIN_LENGTH} characters` };
  }

  if (name.length > MAX_LENGTH) {
    return { valid: false, error: `Alias must be at most ${MAX_LENGTH} characters` };
  }

  if (name !== name.toLowerCase()) {
    return { valid: false, error: 'Alias must be lowercase' };
  }

  if (CONSECUTIVE_HYPHENS_REGEX.test(name)) {
    return { valid: false, error: 'Alias cannot contain consecutive hyphens' };
  }

  if (!ALIAS_NAME_REGEX.test(name)) {
    return { valid: false, error: 'Alias must start and end with a letter or number, and contain only letters, numbers, and hyphens' };
  }

  return { valid: true };
}

/**
 * Generate a random alias in the format: adjective-noun-4digits.
 * Example: "zk-tiger-7842"
 */
export function generateRandomAlias(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const digits = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `${adj}-${noun}-${digits}`;
}

/**
 * Hash an alias (localPart@domain) using SHA-256.
 * Returns 32-byte Uint8Array suitable for Bytes<32> contract parameter.
 */
export async function hashAlias(localPart: string, domain: string = ALIAS_DOMAIN): Promise<Uint8Array> {
  const email = `${localPart}@${domain}`;
  const encoded = new TextEncoder().encode(email);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return new Uint8Array(hash);
}
