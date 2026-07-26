/**
 * Typed wrapper around the native Rust core for identity (alias persona) generation.
 */
import NativeVaultManager from '@/specs/NativeVaultManager';
import type { Identity } from '@/utils/dist/core/models/identity';

/**
 * Request for {@link generateIdentity}. All fields except `language` are optional.
 */
export type IdentityRequest = {
  /** Dictionary language code (e.g. 'en'); unknown codes fall back to English. */
  language: string;
  /** Gender preference: 'male', 'female' or 'random' (default). */
  gender?: string;
  /** Age range preference as stored in settings (e.g. '21-25' or 'random'). */
  ageRange?: string;
};

/**
 * Name and birth date input for identity-based username/email prefix generation.
 */
export type IdentityNameInput = {
  firstName: string;
  lastName: string;
  /** Birth date; only the leading yyyy year part is used. */
  birthDate: string;
};

/**
 * Generate a random identity (alias persona) in the Rust core.
 *
 * @param request The identity request (language, gender, ageRange).
 * @returns The generated identity with a yyyy-MM-dd birth date string.
 */
export async function generateIdentity(request: IdentityRequest): Promise<Identity> {
  const identityJson = await NativeVaultManager.generateIdentity(JSON.stringify(request));
  return JSON.parse(identityJson) as Identity;
}

/**
 * Generate a username from persona name fields (alphanumeric, 6-20 characters).
 *
 * @param input The name input (firstName, lastName, birthDate).
 * @returns The generated username.
 */
export async function generateIdentityUsername(input: IdentityNameInput): Promise<string> {
  return NativeVaultManager.generateIdentityUsername(JSON.stringify(input));
}

/**
 * Generate an email prefix from persona name fields (6-20 characters).
 *
 * @param input The name input (firstName, lastName, birthDate).
 * @returns The generated email prefix.
 */
export async function generateIdentityEmailPrefix(input: IdentityNameInput): Promise<string> {
  return NativeVaultManager.generateIdentityEmailPrefix(JSON.stringify(input));
}

/**
 * Generate a random alphanumeric email prefix that is not based on any identity.
 * Used for login-type credentials where no persona fields are available.
 *
 * @param length The desired prefix length.
 * @returns The generated prefix.
 */
export async function generateRandomEmailPrefix(length: number = 14): Promise<string> {
  return NativeVaultManager.generateRandomEmailPrefix(length);
}

/**
 * Get the list of bundled identity dictionary language ISO codes.
 * The set is owned by the Rust core; unknown codes fall back to English during generation.
 *
 * @returns The available language codes.
 */
export async function getIdentityLanguages(): Promise<string[]> {
  const languages = await NativeVaultManager.getIdentityLanguages();
  return languages.length > 0 ? languages : ['en'];
}

/**
 * Get the list of identity age range option values ('random' plus 5-year ranges).
 *
 * @returns The available age range values.
 */
export async function getIdentityAgeRanges(): Promise<string[]> {
  return NativeVaultManager.getIdentityAgeRanges();
}
