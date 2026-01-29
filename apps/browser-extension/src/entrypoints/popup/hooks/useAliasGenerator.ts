import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

import { useDb } from '@/entrypoints/popup/context/DbContext';

import { IdentityHelperUtils, CreateIdentityGenerator, convertAgeRangeToBirthdateOptions, UsernameEmailGenerator } from '@/utils/dist/core/identity-generator';
import { CreatePasswordGenerator } from '@/utils/dist/core/password-generator';

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
  generateRandomEmailPrefix: () => string;
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
   * Initialize generators for random alias generation.
   */
  const initializeGenerators = useCallback(async () => {
    if (!dbContext?.sqliteClient) {
      throw new Error('Database not initialized');
    }

    // Get effective identity language (smart default based on UI language if no explicit override)
    const identityLanguage = dbContext.sqliteClient.settings.getEffectiveIdentityLanguage();

    // Initialize identity generator based on language
    const identityGenerator = CreateIdentityGenerator(identityLanguage);

    // Initialize password generator with settings from vault
    const passwordSettings = dbContext.sqliteClient.settings.getPasswordSettings();
    const passwordGenerator = CreatePasswordGenerator(passwordSettings);

    return { identityGenerator, passwordGenerator };
  }, [dbContext?.sqliteClient]);

  /**
   * Generate random alias data.
   * Returns the generated data for the caller to use.
   */
  const generateAlias = useCallback(async (): Promise<GeneratedAliasData | null> => {
    if (!dbContext?.sqliteClient) {
      return null;
    }

    try {
      const { identityGenerator, passwordGenerator } = await initializeGenerators();

      // Get gender preference from database
      const genderPreference = dbContext.sqliteClient.settings.getDefaultIdentityGender();

      // Get age range preference and convert to birthdate options
      const ageRange = dbContext.sqliteClient.settings.getDefaultIdentityAgeRange();
      const birthdateOptions = convertAgeRangeToBirthdateOptions(ageRange);

      // Generate identity with gender preference and birthdate options
      const identity = identityGenerator.generateRandomIdentity(genderPreference, birthdateOptions);
      const password = passwordGenerator.generateRandomPassword();

      const defaultEmailDomain = dbContext.sqliteClient.settings.getDefaultEmailDomain();
      const email = defaultEmailDomain ? `${identity.emailPrefix}@${defaultEmailDomain}` : identity.emailPrefix;

      const generatedData: GeneratedAliasData = {
        email,
        firstName: identity.firstName,
        lastName: identity.lastName,
        gender: identity.gender,
        birthdate: IdentityHelperUtils.normalizeBirthDate(identity.birthDate.toISOString()),
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
  }, [dbContext?.sqliteClient, initializeGenerators]);

  /**
   * Generate a random string email prefix (not identity-based).
   * Used for Login-type credentials where no persona fields are available.
   */
  const generateRandomEmailPrefix = useCallback((): string => {
    const generator = new UsernameEmailGenerator();
    return generator.generateRandomEmailPrefix();
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
