import { IdentityGenerator } from "src/implementations/base/IdentityGenerator";
import { IdentityGeneratorDa } from "src/implementations/IdentityGeneratorDa";
import { IdentityGeneratorDe } from "src/implementations/IdentityGeneratorDe";
import { IdentityGeneratorEn } from "src/implementations/IdentityGeneratorEn";
import { IdentityGeneratorEs } from "src/implementations/IdentityGeneratorEs";
import { IdentityGeneratorFa } from "src/implementations/IdentityGeneratorFa";
import { IdentityGeneratorFr } from "src/implementations/IdentityGeneratorFr";
import { IdentityGeneratorIt } from "src/implementations/IdentityGeneratorIt";
import { IdentityGeneratorNl } from "src/implementations/IdentityGeneratorNl";
import { IdentityGeneratorRo } from "src/implementations/IdentityGeneratorRo";
import { IdentityGeneratorSv } from "src/implementations/IdentityGeneratorSv";
import { IdentityGeneratorUr } from "src/implementations/IdentityGeneratorUr";

/**
 * Creates a new identity generator based on the language.
 * Falls back to English if the requested language is not supported.
 * @param language - The language to use for generating the identity (e.g. "da", "de", "en", "es", "fa", "fr", "it", "nl", "ro", "sv", "ur").
 * @returns A new identity generator instance.
 */
export const CreateIdentityGenerator = (language: string): IdentityGenerator => {
  switch (language.toLowerCase()) {
    case 'da':
      return new IdentityGeneratorDa();
    case 'de':
      return new IdentityGeneratorDe();
    case 'en':
      return new IdentityGeneratorEn();
    case 'es':
      return new IdentityGeneratorEs();
    case 'fa':
      return new IdentityGeneratorFa();
    case 'fr':
      return new IdentityGeneratorFr();
    case 'it':
      return new IdentityGeneratorIt();
    case 'nl':
      return new IdentityGeneratorNl();
    case 'ro':
      return new IdentityGeneratorRo();
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
