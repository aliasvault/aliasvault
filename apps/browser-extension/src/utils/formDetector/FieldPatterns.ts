/**
 * A single field pattern entry: terms that match a field type, plus optional
 * terms that veto a match. Exclusions are applied with whole-word semantics
 * and let us narrow broad include patterns (e.g. "token" hits "test-tokenfield"
 * widgets that aren't actually 2FA inputs).
 */
export type FieldPatternEntry = {
    include: string[];
    exclude?: string[];
}

/**
 * Type for field patterns. These patterns are used to detect individual fields in the form.
 */
export type FieldPatterns = {
    username: FieldPatternEntry;
    firstName: FieldPatternEntry;
    lastName: FieldPatternEntry;
    fullName: FieldPatternEntry;
    email: FieldPatternEntry;
    emailConfirm: FieldPatternEntry;
    password: FieldPatternEntry;
    birthdate: FieldPatternEntry;
    gender: FieldPatternEntry;
    birthDateDay: FieldPatternEntry;
    birthDateMonth: FieldPatternEntry;
    birthDateYear: FieldPatternEntry;
    totp: FieldPatternEntry;
}

/**
 * Type for gender option patterns. These patterns are used to detect individual gender options (radio/select) in the form.
 */
export type GenderOptionPatterns = {
    male: string[];
    female: string[];
    other: string[];
}

/**
 * Type for date option patterns. These patterns are used to detect individual date options (select) in the form.
 * Each array in months must contain exactly 12 elements representing the months in a specific language.
 */
export type DateOptionPatterns = {
    months: string[][];
}

/**
 * Type for email verification context patterns. These patterns are used to detect if a form
 * is for email verification (not TOTP/2FA). Each pattern should detect common phrases
 * found in email verification flows (specifically in links/buttons).
 */
export type EmailVerificationPatterns = {
    resendCode: RegExp[];
    changeEmail: RegExp[];
}

/**
 * Type for field exclusion patterns. These patterns are used to exclude fields from autofill detection.
 * Fields matching these patterns should not trigger the autofill popup, even if they match
 * other field patterns (like username or email).
 */
export type FieldExclusionPatterns = string[];

/**
 * English field patterns to detect English form fields.
 *
 * Each entry has an `include` list (terms that match the field type) and an
 * optional `exclude` list (terms that veto a match for this field type only).
 * Excludes are matched with whole-word semantics — useful for narrowing broad
 * include terms (e.g. TOTP's "token" matches "test-tokenfield" widgets).
 */
export const EnglishFieldPatterns: FieldPatterns = {
  username: { include: ['username', 'login', 'identifier', 'user'] },
  fullName: { include: ['fullname', 'full-name', 'full name'] },
  firstName: { include: ['firstname', 'first-name', 'first_name', 'fname', 'name', 'given-name'] },
  lastName: { include: ['lastname', 'last-name', 'last_name', 'lname', 'surname', 'family-name'] },
  email: { include: ['email', 'mail', 'emailaddress'] },
  emailConfirm: { include: ['confirm', 'verification', 'repeat', 'retype', 'verify', 'email2'] },
  password: { include: ['password', 'pwd', 'pass'] },
  birthdate: { include: ['birthdate', 'birth-date', 'dob', 'date-of-birth'] },
  gender: { include: ['gender', 'sex'] },
  birthDateDay: { include: ['-day', 'birthdate_d', 'birthdayday', '_day', 'day'] },
  birthDateMonth: { include: ['-month', 'birthdate_m', 'birthdaymonth', '_month', 'month'] },
  birthDateYear: { include: ['-year', 'birthdate_y', 'birthdayyear', '_year', 'year'] },
  totp: {
    include: ['totp', 'otp', 'one-time', 'onetime', 'six-digit', 'digit-code', 'token', 'authenticator', 'authentication', '2fa', 'twofa', 'two-factor', 'mfa', 'security-code', 'auth-code', 'passcode', 'pin-code', 'pincode', 'google_code', 'verification-code', 'verificationcode', 'tfa', 'tfacode', 'second-factor', 'one time password', 'code'],
    exclude: ['test']
  }
};

/**
 * English gender option patterns.
 */
export const EnglishGenderOptionPatterns: GenderOptionPatterns = {
  male: ['male', 'man', 'm', 'gender1', 'mr', 'mr.'],
  female: ['female', 'woman', 'f', 'gender2', 'mrs', 'mrs.', 'ms', 'ms.'],
  other: ['other', 'diverse', 'custom', 'prefer not', 'unknown', 'gender3']
};

/**
 * English date option patterns. These are used to detect the month name in the date field.
 */
export const EnglishDateOptionPatterns: DateOptionPatterns = {
  months: [
    ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
  ],
};

/**
 * English email verification patterns. These are used to detect email verification forms
 * (not TOTP/2FA forms) by analyzing link/button text in the form context.
 */
export const EnglishEmailVerificationPatterns: EmailVerificationPatterns = {
  resendCode: [
    /resend/i,
    /re-send/i,
    /send\s+again/i,
    /send\s+code\s+again/i
  ],
  changeEmail: [
    /different\s+email/i,
    /change\s+email/i,
    /update\s+email/i,
    /use\s+another\s+email/i
  ]
};

/**
 * English field exclusion patterns. These patterns identify fields that should NOT trigger autofill,
 * such as search boxes, filters, and configuration fields. These are commonly found in admin panels,
 * data tables, settings pages, and navigation areas where autofill would be inappropriate.
 */
export const EnglishFieldExclusionPatterns: FieldExclusionPatterns = [
  // Search and filter fields
  'search', 'find', 'lookup', 'searchbox', 'search-box', 'searchfield', 'search-field', 'searchinput', 'search-input', 'searchquery', 'search-query',
  'filter', 'filterable', 'filterinput', 'filter-input', 'filterfield', 'filter-field', 'filterbox', 'filter-box',
  // Settings and configuration fields
  'setting', 'settings', 'config', 'configuration', 'timeout', 'duration', 'interval', 'refresh', 'access'
];

/**
 * English words to filter out from page titles during autofill matching to
 * prevent generic words from causing false positives.
 */
export const EnglishStopWords = new Set([
  // Authentication related
  'login', 'signin', 'sign', 'register', 'signup', 'account',
  'authentication', 'password', 'access', 'auth', 'session',
  'authenticate', 'credentials', 'logout', 'signout',

  // Navigation/Site sections
  'portal', 'dashboard', 'home', 'welcome', 'page', 'site',
  'secure', 'member', 'user', 'profile', 'settings', 'menu',
  'overview', 'index', 'main', 'start', 'landing',

  // Marketing/Promotional
  'free', 'create', 'new', 'your', 'special', 'offer',
  'deal', 'discount', 'promotion', 'newsletter',

  // Common website sections
  'help', 'support', 'contact', 'about', 'faq', 'terms',
  'privacy', 'cookie', 'service', 'services', 'products',
  'shop', 'store', 'cart', 'checkout',

  // Generic descriptors
  'online', 'web', 'digital', 'mobile', 'my', 'personal',
  'private', 'general', 'default', 'standard', 'website',

  // System/Technical
  'system', 'admin', 'administrator', 'platform', 'portal',
  'gateway', 'api', 'interface', 'console',

  // Time-related
  'today', 'now', 'current', 'latest', 'newest', 'recent',

  // General
  'the', 'and', 'or', 'but', 'to', 'up'
]);

/**
 * Dutch field patterns used to detect Dutch form fields.
 */
export const DutchFieldPatterns: FieldPatterns = {
  username: { include: ['gebruikersnaam', 'gebruiker', 'login', 'identifier'] },
  fullName: { include: ['volledige naam'] },
  firstName: { include: ['voornaam', 'naam'] },
  lastName: { include: ['achternaam'] },
  email: { include: ['e-mailadres', 'e-mail'] },
  emailConfirm: { include: ['bevestig', 'herhaal', 'verificatie'] },
  password: { include: ['wachtwoord', 'pwd'] },
  birthdate: { include: ['geboortedatum', 'geboorte-datum'] },
  gender: { include: ['geslacht', 'aanhef'] },
  birthDateDay: { include: ['dag'] },
  birthDateMonth: { include: ['maand'] },
  birthDateYear: { include: ['jaar'] },
  totp: { include: ['verificatiecode', 'eenmalig', 'authenticatie', 'tweefactor', 'beveiligingscode'] }
};

/**
 * Dutch field exclusion patterns. These patterns identify fields that should NOT trigger autofill.
 */
export const DutchFieldExclusionPatterns: FieldExclusionPatterns = [
  // Search and filter fields
  'zoeken', 'zoek', 'zoekveld', 'zoek-veld', 'zoekinput', 'zoek-input', 'zoekbox', 'zoek-box',
  'filter', 'filteren', 'filterveld', 'filter-veld', 'filterinput', 'filter-input',
  // Settings and configuration fields
  'instelling', 'instellingen', 'configuratie', 'timeout', 'interval',
];

/**
 * Dutch gender option patterns
 */
export const DutchGenderOptionPatterns: GenderOptionPatterns = {
  male: ['man', 'mannelijk', 'heer'],
  female: ['vrouw', 'vrouwelijk', 'mevrouw'],
  other: ['anders', 'iets', 'overig', 'onbekend']
};

/**
 * Dutch date option patterns. These are used to detect the month name in the date field.
 */
export const DutchDateOptionPatterns: DateOptionPatterns = {
  months: [
    ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']
  ],
};

/**
 * Dutch email verification patterns. These are used to detect email verification forms
 * (not TOTP/2FA forms) by analyzing link/button text in the form context.
 */
export const DutchEmailVerificationPatterns: EmailVerificationPatterns = {
  resendCode: [
    /opnieuw\s+verzenden/i,
    /verstuur\s+opnieuw/i,
    /code\s+opnieuw/i,
    /opnieuw\s+versturen/i
  ],
  changeEmail: [
    /ander\s+e-?mail/i,
    /wijzig\s+e-?mail/i,
    /e-?mail\s+wijzigen/i,
    /ander\s+e-?mailadres/i
  ]
};

/**
 * Dutch words to filter out from page titles during autofill matching to
 * prevent generic words from causing false positives.
 */
export const DutchStopWords = new Set([
  // Authentication related
  'inloggen', 'registreren', 'registratie', 'aanmelden',
  'inschrijven', 'uitloggen', 'wachtwoord', 'toegang',
  'authenticatie', 'account',

  // Navigation/Site sections
  'portaal', 'overzicht', 'startpagina', 'welkom', 'pagina',
  'beveiligd', 'lid', 'gebruiker', 'profiel', 'instellingen',
  'menu', 'begin', 'hoofdpagina',

  // Marketing/Promotional
  'gratis', 'nieuw', 'jouw', 'schrijf', 'nieuwsbrief',
  'aanbieding', 'korting', 'speciaal', 'actie',

  // Common website sections
  'hulp', 'ondersteuning', 'contact', 'over', 'voorwaarden',
  'privacy', 'cookie', 'dienst', 'diensten', 'producten',
  'winkel', 'bestellen', 'winkelwagen',

  // Generic descriptors
  'online', 'web', 'digitaal', 'mobiel', 'mijn', 'persoonlijk',
  'privé', 'algemeen', 'standaard',

  // System/Technical
  'systeem', 'beheer', 'beheerder', 'platform', 'portaal',
  'interface', 'console',

  // Time-related
  'vandaag', 'nu', 'huidig', 'recent', 'nieuwste',

  // General
  'je', 'in', 'op', 'de', 'van', 'ons', 'allemaal'
]);

/*
 * Import translation-based patterns dynamically
 * These patterns are extracted from all i18n translation files
 */
import { TranslationEmailPatterns, TranslationUsernamePatterns, TranslationPasswordPatterns } from './TranslationPatterns';

/**
 * Merge per-field-type entries (include + optional exclude) from one or more
 * languages, deduping each list while preserving original order.
 */
function mergeEntries(...entries: FieldPatternEntry[]): FieldPatternEntry {
  const include = [...new Set(entries.flatMap(e => e.include))];
  const exclude = [...new Set(entries.flatMap(e => e.exclude ?? []))];
  return exclude.length > 0 ? { include, exclude } : { include };
}

/**
 * Combined field patterns which includes all supported languages.
 * This includes:
 * - Hardcoded English and Dutch patterns
 * - Translation-based patterns from all supported languages
 */
export const CombinedFieldPatterns: FieldPatterns = {
  username: mergeEntries(EnglishFieldPatterns.username, DutchFieldPatterns.username, { include: TranslationUsernamePatterns }),
  fullName: mergeEntries(EnglishFieldPatterns.fullName, DutchFieldPatterns.fullName),
  firstName: mergeEntries(EnglishFieldPatterns.firstName, DutchFieldPatterns.firstName),
  lastName: mergeEntries(EnglishFieldPatterns.lastName, DutchFieldPatterns.lastName),
  /**
   * NOTE: Dutch email patterns should be prioritized over English email patterns due to how
   * the nl-registration-form5.html honeypot field is named. The order of the patterns
   * determine which field is detected. If a pattern entry with higher index is detected, that
   * field will be selected instead of the lower index one.
   *
   * Translation patterns are added last to catch all language variations (e.g., "E-post" in Swedish)
   */
  email: mergeEntries(DutchFieldPatterns.email, EnglishFieldPatterns.email, { include: TranslationEmailPatterns }),
  emailConfirm: mergeEntries(EnglishFieldPatterns.emailConfirm, DutchFieldPatterns.emailConfirm),
  password: mergeEntries(EnglishFieldPatterns.password, DutchFieldPatterns.password, { include: TranslationPasswordPatterns }),
  birthdate: mergeEntries(EnglishFieldPatterns.birthdate, DutchFieldPatterns.birthdate),
  gender: mergeEntries(EnglishFieldPatterns.gender, DutchFieldPatterns.gender),
  birthDateDay: mergeEntries(EnglishFieldPatterns.birthDateDay, DutchFieldPatterns.birthDateDay),
  birthDateMonth: mergeEntries(EnglishFieldPatterns.birthDateMonth, DutchFieldPatterns.birthDateMonth),
  birthDateYear: mergeEntries(EnglishFieldPatterns.birthDateYear, DutchFieldPatterns.birthDateYear),
  totp: mergeEntries(EnglishFieldPatterns.totp, DutchFieldPatterns.totp)
};

/**
 * Combined gender option patterns which includes all supported languages.
 */
export const CombinedGenderOptionPatterns: GenderOptionPatterns = {
  male: [...new Set([...EnglishGenderOptionPatterns.male, ...DutchGenderOptionPatterns.male])],
  female: [...new Set([...EnglishGenderOptionPatterns.female, ...DutchGenderOptionPatterns.female])],
  other: [...new Set([...EnglishGenderOptionPatterns.other, ...DutchGenderOptionPatterns.other])]
};

/**
 * Combined date option patterns which includes all supported languages.
 * Each array in months must contain exactly 12 elements representing the months in a specific language.
 * These are used to detect the month name in the date field.
 */
export const CombinedDateOptionPatterns: DateOptionPatterns = {
  months: [
    ...EnglishDateOptionPatterns.months,
    ...DutchDateOptionPatterns.months
  ],
};

/**
 * Combined stop words from all supported languages. These are used to filter out generic words from page titles
 * during autofill matching to prevent generic words from causing false positives.
 */
export const CombinedStopWords = new Set([
  ...EnglishStopWords,
  ...DutchStopWords
]);

/**
 * Combined email verification patterns from all supported languages. These are used to detect
 * email verification forms (not TOTP/2FA forms) by analyzing link/button text in the form context.
 */
export const CombinedEmailVerificationPatterns: EmailVerificationPatterns = {
  resendCode: [
    ...EnglishEmailVerificationPatterns.resendCode,
    ...DutchEmailVerificationPatterns.resendCode
  ],
  changeEmail: [
    ...EnglishEmailVerificationPatterns.changeEmail,
    ...DutchEmailVerificationPatterns.changeEmail
  ]
};

/**
 * Combined field exclusion patterns from all supported languages. These patterns identify fields
 * that should NOT trigger autofill, regardless of whether they match other field patterns.
 * This prevents false positives on search boxes and filters commonly found
 * in admin panels, data tables, and navigation areas.
 */
export const CombinedFieldExclusionPatterns: FieldExclusionPatterns = [
  ...new Set([...EnglishFieldExclusionPatterns, ...DutchFieldExclusionPatterns])
];
