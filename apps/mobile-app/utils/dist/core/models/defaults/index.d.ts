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
declare const DEFAULT_PASSWORD_LENGTH = 18;
/** Minimum password length offered by the UI length slider. */
declare const MIN_PASSWORD_LENGTH = 8;
/** Maximum password length (also the hard cap enforced by the generator). */
declare const MAX_PASSWORD_LENGTH = 256;
/** Default number of words in a generated Diceware passphrase. */
declare const DEFAULT_WORD_COUNT = 5;
/** Minimum number of words offered by the UI word-count slider. */
declare const MIN_WORD_COUNT = 3;
/** Maximum number of words (also the hard cap enforced by the generator). */
declare const MAX_WORD_COUNT = 10;

export { DEFAULT_PASSWORD_LENGTH, DEFAULT_WORD_COUNT, MAX_PASSWORD_LENGTH, MAX_WORD_COUNT, MIN_PASSWORD_LENGTH, MIN_WORD_COUNT };
