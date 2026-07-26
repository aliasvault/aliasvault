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

      const defaultEmailDomain = dbContext.sqliteClient.settings.getDefaultEmailDomain();
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
  }, [dbContext?.sqliteClient]);

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
    lastGeneratedValues,
    setLastGeneratedValues
  };
};

export default useAliasGenerator;
export type { GeneratedAliasData, LastGeneratedValues };
