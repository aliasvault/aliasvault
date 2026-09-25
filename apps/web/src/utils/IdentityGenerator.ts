/**
 * Identity generator.
 */

import * as RustCore from '@aliasvault/client/rust/RustCore';
import { FieldKey } from '@aliasvault/models/vault';

import { getFieldValue, type ItemEdit } from '@/models/ItemEdit';
import { vaultStore } from '@/vault/VaultStore';

import type { WebApiService } from '@aliasvault/client/api/WebApiService';
import type SqliteClient from '@aliasvault/client/database/SqliteClient';

/** Maximum number of identities generated while looking for an email address that is not taken yet. */
const MAX_EMAIL_ATTEMPTS = 5;

/**
 * A generated alias identity with its login credentials.
 */
export type GeneratedAliasData = {
  email: string;
  firstName: string;
  lastName: string;
  gender: string;
  birthdate: string;
  username: string;
  password: string;
};

/**
 * The email domain for generated aliases that is used by default.
 * @param client - the open vault
 */
export async function resolveDefaultEmailDomain(client: SqliteClient): Promise<string> {
  const metadata = await vaultStore.getVaultMetadata();
  const privateEmailDomains = metadata?.privateEmailDomains ?? [];
  const publicEmailDomains = metadata?.publicEmailDomains ?? [];
  const hiddenPrivateEmailDomains = metadata?.hiddenPrivateEmailDomains ?? [];

  /**
   * Whether a domain can receive mail and is not hidden.
   */
  const isValidDomain = (domain: string): boolean => Boolean(domain) && domain !== 'DISABLED.TLD' && !hiddenPrivateEmailDomains.includes(domain) && (privateEmailDomains.includes(domain) || publicEmailDomains.includes(domain));

  const configuredDomain = client.settings.getDefaultEmailDomain();
  if (isValidDomain(configuredDomain)) {
    return configuredDomain;
  }

  return privateEmailDomains.find(isValidDomain) ?? publicEmailDomains.find(isValidDomain) ?? '';
}

/**
 * Prefix an email address with the default domain, when there is one.
 */
async function withDefaultDomain(client: SqliteClient, prefix: string): Promise<string> {
  const domain = await resolveDefaultEmailDomain(client);
  return domain.length > 0 ? `${prefix}@${domain}` : prefix;
}

/**
 * A random identity and password.
 * @param client - the open vault
 */
async function generateAlias(client: SqliteClient): Promise<GeneratedAliasData> {
  const identity = await RustCore.generateIdentity({
    language: await client.settings.getEffectiveIdentityLanguage(),
    gender: client.settings.getDefaultIdentityGender(),
    ageRange: client.settings.getDefaultIdentityAgeRange(),
  });
  const password = await RustCore.generatePassword(client.settings.getPasswordSettings());

  return {
    email: await withDefaultDomain(client, identity.emailPrefix),
    firstName: identity.firstName,
    lastName: identity.lastName,
    gender: identity.gender,
    birthdate: identity.birthDate,
    username: identity.nickName,
    password,
  };
}

/**
 * Whether the server already routes an email address to another account.
 */
async function isEmailTaken(webApi: WebApiService, email: string): Promise<boolean> {
  try {
    const result = await webApi.post<null, { isTaken: boolean }>(`Identity/CheckEmail/${encodeURIComponent(email)}`, null);
    return result.isTaken;
  } catch {
    return false;
  }
}

/**
 * Generate a random identity.
 * @param client - the open vault
 * @param webApi - the API to check the email address with
 */
export async function generateIdentity(client: SqliteClient, webApi: WebApiService): Promise<GeneratedAliasData | null> {
  try {
    let generated = await generateAlias(client);
    for (let attempt = 1; attempt < MAX_EMAIL_ATTEMPTS; attempt++) {
      if (!generated.email.includes('@') || !await isEmailTaken(webApi, generated.email)) {
        break;
      }
      generated = await generateAlias(client);
    }
    return generated;
  } catch (error) {
    console.error('Error generating random alias:', error);
    return null;
  }
}

/**
 * A username from the alias identity on the form, or from a random identity when the form has none.
 * @param client - the open vault
 * @param edit - the item form
 */
export async function generateUsername(client: SqliteClient, edit: ItemEdit): Promise<string> {
  let firstName = getFieldValue(edit, FieldKey.AliasFirstName);
  let lastName = getFieldValue(edit, FieldKey.AliasLastName);
  let birthDate = getFieldValue(edit, FieldKey.AliasBirthdate);
  if (firstName.trim().length === 0 && lastName.trim().length === 0 && birthDate.trim().length === 0) {
    ({ firstName, lastName, birthdate: birthDate } = await generateAlias(client));
  }
  return RustCore.generateIdentityUsername({ firstName, lastName, birthDate });
}

/**
 * An email address on the default domain, based on the alias identity when the form has one.
 * @param client - the open vault
 * @param edit - the item form
 */
export async function generateAliasEmail(client: SqliteClient, edit: ItemEdit): Promise<string> {
  const firstName = getFieldValue(edit, FieldKey.AliasFirstName);
  const lastName = getFieldValue(edit, FieldKey.AliasLastName);
  const prefix = firstName.trim().length === 0 && lastName.trim().length === 0
    ? await RustCore.generateRandomEmailPrefix()
    : await RustCore.generateIdentityEmailPrefix({ firstName, lastName, birthDate: getFieldValue(edit, FieldKey.AliasBirthdate) });
  return withDefaultDomain(client, prefix);
}

/**
 * A random email address on the default domain.
 * @param client - the open vault
 */
export async function generateRandomEmail(client: SqliteClient): Promise<string> {
  return withDefaultDomain(client, await RustCore.generateRandomEmailPrefix());
}
