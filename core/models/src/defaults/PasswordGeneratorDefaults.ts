/**
 * Single source of truth for the password-length and Diceware word-count
 * defaults and UI slider ranges shared across every AliasVault client.
 *
 * This file is distributed by core/models/build.sh to all platforms including:
 *   - `core/rust/src/password_generator/defaults.rs` (Rust core)
 *   - `apps/server/Databases/AliasClientDb/Models/PasswordGeneratorDefaults.cs` (C# web client)
 *
 * The TypeScript clients (browser extension, mobile app) import the constants directly from `@/utils/dist/core/models/defaults`.
 */

/** Default length of a generated basic password. */
export const DEFAULT_PASSWORD_LENGTH = 18;

/** Minimum password length offered by the UI length slider. */
export const MIN_PASSWORD_LENGTH = 8;

/** Maximum password length (also the hard cap enforced by the generator). */
export const MAX_PASSWORD_LENGTH = 256;

/** Default number of words in a generated Diceware passphrase. */
export const DEFAULT_WORD_COUNT = 5;

/** Minimum number of words offered by the UI word-count slider. */
export const MIN_WORD_COUNT = 3;

/** Maximum number of words (also the hard cap enforced by the generator). */
export const MAX_WORD_COUNT = 10;
