import { IdentityGenerator } from "src/implementations/base/IdentityGenerator";
import { IdentityGeneratorEn } from "src/implementations/IdentityGeneratorEn";
import { IdentityGeneratorNl } from "src/implementations/IdentityGeneratorNl";
import { IdentityGeneratorDe } from "src/implementations/IdentityGeneratorDe";
import { IdentityGeneratorIt } from "src/implementations/IdentityGeneratorIt";
import { IdentityGeneratorEs } from "src/implementations/IdentityGeneratorEs";
import { IdentityGeneratorRo } from "src/implementations/IdentityGeneratorRo";
import { IdentityGeneratorFa } from "src/implementations/IdentityGeneratorFa";
import { IdentityGeneratorFr } from "src/implementations/IdentityGeneratorFr";
import { IdentityGeneratorSv } from "src/implementations/IdentityGeneratorSv";
import { IdentityGeneratorUr } from "src/implementations/IdentityGeneratorUr";

/**
 * Creates a new identity generator based on the language.
 * Falls back to English if the requested language is not supported.
 * @param language - The language to use for generating the identity (e.g. "en", "nl", "de", "it", "es", "ro", "fa", "fr", "sv", "ur").
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
    case 'it':
      return new IdentityGeneratorIt();
    case 'es':
      return new IdentityGeneratorEs();
    case 'ro':
      return new IdentityGeneratorRo();
    case 'fa':
      return new IdentityGeneratorFa();
    case 'fr':
      return new IdentityGeneratorFr();
    case 'sv':
      return new IdentityGeneratorSv();
    case 'ur':
      return new IdentityGeneratorUr();
    default:
      // Fallback to English for unsupported languages
      console.warn(`Language '${language}' is not supported. Falling back to English.`);
      return new IdentityGeneratorEn();
  }
};
