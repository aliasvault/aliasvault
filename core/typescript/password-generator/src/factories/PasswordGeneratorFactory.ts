import { PasswordSettings } from "src/types/PasswordSettings";
import { PasswordGenerator } from "src/utils/PasswordGenerator";

/**
 * Creates a new password generator.
 * @param settings - The settings for the password generator.
 * @returns A new password generator instance.
 */
export const CreatePasswordGenerator = (settings: PasswordSettings): PasswordGenerator => {
  return new PasswordGenerator(settings);
};
