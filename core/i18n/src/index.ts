/**
 * Shared translations of the AliasVault apps. The files in ../locales are the single source of truth:
 * en.json is edited by hand, the other languages are written by Crowdin.
 */

import en from '../locales/en.json';

export * from './languages';

/**
 * A (nested) translation tree as loaded from a locale file.
 */
export type TranslationTree = { [key: string]: string | TranslationTree };

/**
 * The dotted paths to the leaves of a translation tree.
 */
type LeafKeys<T> = { [K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafKeys<T[K]>}` }[keyof T & string];

/**
 * A key of the English translations, e.g. 'common.errors.unknownError'.
 */
export type TranslationKey = LeafKeys<typeof en>;

/**
 * The English translations, bundled so there always is a fallback.
 */
export const englishTranslations: TranslationTree = en;

/**
 * Read a value from a translation tree by its dotted key, e.g. 'common.errors.unknownError'.
 * @param tree - the translation tree
 * @param key - the dotted key
 */
export function getTranslation(tree: TranslationTree, key: string): string | undefined {
  const value = key.split('.').reduce<string | TranslationTree | undefined>((node, segment) => (node && typeof node === 'object' ? node[segment] : undefined), tree);
  return typeof value === 'string' ? value : undefined;
}
