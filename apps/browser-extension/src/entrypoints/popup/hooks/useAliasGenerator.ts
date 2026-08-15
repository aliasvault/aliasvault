import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

import { useDb } from '@/entrypoints/popup/context/DbContext';

import * as RustCore from '@/utils/RustCore';

/**
 * Generated alias data returned by the hook.
 */
type GeneratedAliasData = {
  email: string;
  firstName: string;
  lastName: string;
  gender: string;
  birthdate: string;
  username: string;
  password: string;
};

/**
 * Tracking state for last generated values.
 */
type LastGeneratedValues = {
  username: string | null;
  password: string | null;
  email: string | null;
};

/**
 * Hook for generating random alias identity data.
 * Handles identity and password generation based on user preferences.
 */
const useAliasGenerator = (): {
  generateAlias: () => Promise<GeneratedAliasData | null>;
  generateRandomEmailPrefix: () => Promise<string>;
  resolveDefaultEmailDomain: () => Promise<string>;
  lastGeneratedValues: LastGeneratedValues;
  setLastGeneratedValues: Dispatch<SetStateAction<LastGeneratedValues>>;
} => {
  const dbContext = useDb();

  const [lastGeneratedValues, setLastGeneratedValues] = useState<LastGeneratedValues>({
    username: null,
    password: null,
    email: null
  });

  /**
   * Resolve the email domain to use for generated aliases. Falls back to the first available
   * private (or public) domain when the vault has no valid default domain configured, so that
   * generated emails always include a domain.
   */
  const resolveDefaultEmailDomain = useCallback(async (): Promise<string> => {
    const metadata = await dbContext.getVaultMetadata();
    const privateEmailDomains = metadata?.privateEmailDomains ?? [];
    const publicEmailDomains = metadata?.publicEmailDomains ?? [];
    const hiddenPrivateEmailDomains = metadata?.hiddenPrivateEmailDomains ?? [];
    
    /**
     * Check if a domain is valid.
     */
    const isValidDomain = (domain: string): boolean => Boolean(domain) &&
      domain !== 'DISABLED.TLD' &&
      !hiddenPrivateEmailDomains.includes(domain) &&
      (privateEmailDomains.includes(domain) || publicEmailDomains.includes(domain));

    const configuredDomain = dbContext.sqliteClient?.settings.getDefaultEmailDomain() ?? '';
    if (isValidDomain(configuredDomain)) {
      return configuredDomain;
    }

    return privateEmailDomains.find(isValidDomain) ?? publicEmailDomains.find(isValidDomain) ?? '';
  }, [dbContext]);

  /**
   * Generate random alias data.
   * Returns the generated data for the caller to use.
   */
  const generateAlias = useCallback(async (): Promise<GeneratedAliasData | null> => {
    if (!dbContext?.sqliteClient) {
      return null;
    }

    try {
      // Get effective identity language (smart default based on UI language if no explicit override)
      const identityLanguage = await dbContext.sqliteClient.settings.getEffectiveIdentityLanguage();

      // Get gender and age range preferences from database
      const genderPreference = dbContext.sqliteClient.settings.getDefaultIdentityGender();
      const ageRange = dbContext.sqliteClient.settings.getDefaultIdentityAgeRange();

      // Generate identity and password in the Rust core
      const identity = await RustCore.generateIdentity({
        language: identityLanguage,
        gender: genderPreference,
        ageRange
      });
      const passwordSettings = dbContext.sqliteClient.settings.getPasswordSettings();
      const password = await RustCore.generatePassword(passwordSettings);

      const defaultEmailDomain = await resolveDefaultEmailDomain();
      const email = defaultEmailDomain ? `${identity.emailPrefix}@${defaultEmailDomain}` : identity.emailPrefix;

      const generatedData: GeneratedAliasData = {
        email,
        firstName: identity.firstName,
        lastName: identity.lastName,
        gender: identity.gender,
        birthdate: identity.birthDate,
        username: identity.nickName,
        password
      };

      // Update tracking with new generated values
      setLastGeneratedValues({
        username: identity.nickName,
        password: password,
        email: email
      });

      return generatedData;
    } catch (error) {
      console.error('Error generating random alias:', error);
      return null;
    }
  }, [dbContext?.sqliteClient, resolveDefaultEmailDomain]);

  /**
   * Generate a random string email prefix (not identity-based).
   * Used for Login-type credentials where no persona fields are available.
   */
  const generateRandomEmailPrefix = useCallback((): Promise<string> => {
    return RustCore.generateRandomEmailPrefix();
  }, []);

  return {
    generateAlias,
    generateRandomEmailPrefix,
    resolveDefaultEmailDomain,
    lastGeneratedValues,
    setLastGeneratedValues
  };
};

export default useAliasGenerator;
export type { GeneratedAliasData, LastGeneratedValues };
