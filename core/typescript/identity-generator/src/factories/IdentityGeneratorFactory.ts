import { IdentityGenerator } from "src/implementations/base/IdentityGenerator";
import { IdentityGeneratorEn } from "src/implementations/IdentityGeneratorEn";
import { IdentityGeneratorNl } from "src/implementations/IdentityGeneratorNl";
import { IdentityGeneratorDe } from "src/implementations/IdentityGeneratorDe";

/**
 * Creates a new identity generator based on the language.
 * Falls back to English if the requested language is not supported.
 * @param language - The language to use for generating the identity (e.g. "en", "nl", "de").
 * @returns A new identity generator instance.
 */
export const CreateIdentityGenerator = (language: string): IdentityGenerator => {
  switch (language.toLowerCase()) {
    case 'en':
      return new IdentityGeneratorEn();
    case 'nl':
      return new IdentityGeneratorNl();
    case 'de':
      return new IdentityGeneratorDe();
    default:
      // Fallback to English for unsupported languages
      console.warn(`Language '${language}' is not supported. Falling back to English.`);
      return new IdentityGeneratorEn();
  }
};
