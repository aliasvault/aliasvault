/**
 * Type for field patterns. These patterns are used to detect individual fields in the form.
 */
export type FieldPatterns = {
    username: string[];
    firstName: string[];
    lastName: string[];
    fullName: string[];
    email: string[];
    emailConfirm: string[];
    password: string[];
    birthdate: string[];
    gender: string[];
    birthDateDay: string[];
    birthDateMonth: string[];
    birthDateYear: string[];
    totp: string[];
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
 * found in email verification flows.
 */
export type EmailVerificationPatterns = {
    verifyEmail: RegExp[];
    emailVerification: RegExp[];
    sentCodeToEmail: RegExp[];
    checkEmail: RegExp[];
    confirmEmail: RegExp[];
}

/**
 * English field patterns to detect English form fields.
 */
export const EnglishFieldPatterns: FieldPatterns = {
  username: ['username', 'login', 'identifier', 'user'],
  fullName: ['fullname', 'full-name', 'full name'],
  firstName: ['firstname', 'first-name', 'first_name', 'fname', 'name', 'given-name'],
  lastName: ['lastname', 'last-name', 'last_name', 'lname', 'surname', 'family-name'],
  email: ['email', 'mail', 'emailaddress'],
  emailConfirm: ['confirm', 'verification', 'repeat', 'retype', 'verify', 'email2'],
  password: ['password', 'pwd', 'pass'],
  birthdate: ['birthdate', 'birth-date', 'dob', 'date-of-birth'],
  gender: ['gender', 'sex'],
  birthDateDay: ['-day', 'birthdate_d', 'birthdayday', '_day', 'day'],
  birthDateMonth: ['-month', 'birthdate_m', 'birthdaymonth', '_month', 'month'],
  birthDateYear: ['-year', 'birthdate_y', 'birthdayyear', '_year', 'year'],
  totp: ['totp', 'otp', 'one-time', 'onetime', 'token', 'authenticator', '2fa', 'twofa', 'two-factor', 'mfa', 'security-code', 'auth-code', 'passcode', 'pin-code', 'pincode', 'google_code', 'verification-code', 'verificationcode', 'tfa', 'tfacode', 'second-factor']
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
 * (not TOTP/2FA forms) by analyzing page content.
 */
export const EnglishEmailVerificationPatterns: EmailVerificationPatterns = {
  verifyEmail: [
    /verify\s+your\s+email/i,
    /verify\s+email\s+address/i,
    /email\s+needs\s+verification/i
  ],
  emailVerification: [
    /email\s+verification/i,
    /verification\s+email/i
  ],
  sentCodeToEmail: [
    /we\s+sent\s+(a\s+)?code\s+to.*@/i,
    /sent\s+(a\s+)?(verification\s+)?code\s+to.*@/i,
    /enter\s+the\s+code\s+we\s+sent\s+to.*@/i,
    /code\s+has\s+been\s+sent\s+to.*@/i,
    /we've\s+sent\s+(a\s+)?code\s+to.*@/i
  ],
  checkEmail: [
    /check\s+your\s+email/i,
    /check\s+your\s+inbox/i,
    /please\s+check\s+your\s+email/i
  ],
  confirmEmail: [
    /confirm\s+your\s+email/i,
    /email\s+confirmation/i,
    /confirm\s+email\s+address/i
  ]
};

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
  username: ['gebruikersnaam', 'gebruiker', 'login', 'identifier'],
  fullName: ['volledige naam'],
  firstName: ['voornaam', 'naam'],
  lastName: ['achternaam'],
  email: ['e-mailadres', 'e-mail'],
  emailConfirm: ['bevestig', 'herhaal', 'verificatie'],
  password: ['wachtwoord', 'pwd'],
  birthdate: ['geboortedatum', 'geboorte-datum'],
  gender: ['geslacht', 'aanhef'],
  birthDateDay: ['dag'],
  birthDateMonth: ['maand'],
  birthDateYear: ['jaar'],
  totp: ['verificatiecode', 'eenmalig', 'authenticatie', 'tweefactor', 'beveiligingscode']
};

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
 * (not TOTP/2FA forms) by analyzing page content.
 */
export const DutchEmailVerificationPatterns: EmailVerificationPatterns = {
  verifyEmail: [
    /verifieer\s+je\s+e-?mail/i,
    /e-?mail\s+verifi[eë]ren/i,
    /controleer\s+je\s+e-?mail/i
  ],
  emailVerification: [
    /e-?mail\s+verificatie/i,
    /verificatie\s+e-?mail/i
  ],
  sentCodeToEmail: [
    /we\s+hebben\s+(een\s+)?code\s+gestuurd\s+naar.*@/i,
    /(een\s+)?code\s+verzonden\s+naar.*@/i,
    /voer\s+de\s+code\s+in\s+die\s+we\s+naar.*@\s+hebben\s+gestuurd/i,
    /code\s+is\s+verzonden\s+naar.*@/i
  ],
  checkEmail: [
    /controleer\s+je\s+e-?mail/i,
    /bekijk\s+je\s+inbox/i,
    /controleer\s+je\s+inbox/i
  ],
  confirmEmail: [
    /bevestig\s+je\s+e-?mail/i,
    /e-?mail\s+bevestiging/i,
    /bevestig\s+e-?mailadres/i
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

/**
 * Combined field patterns which includes all supported languages.
 */
export const CombinedFieldPatterns: FieldPatterns = {
  username: [...new Set([...EnglishFieldPatterns.username, ...DutchFieldPatterns.username])],
  fullName: [...new Set([...EnglishFieldPatterns.fullName, ...DutchFieldPatterns.fullName])],
  firstName: [...new Set([...EnglishFieldPatterns.firstName, ...DutchFieldPatterns.firstName])],
  lastName: [...new Set([...EnglishFieldPatterns.lastName, ...DutchFieldPatterns.lastName])],
  /**
   * NOTE: Dutch email patterns should be prioritized over English email patterns due to how
   * the nl-registration-form5.html honeypot field is named. The order of the patterns
   * determine which field is detected. If a pattern entry with higher index is detected, that
   * field will be selected instead of the lower index one.
   */
  email: [...new Set([...DutchFieldPatterns.email, ...EnglishFieldPatterns.email])],
  emailConfirm: [...new Set([...EnglishFieldPatterns.emailConfirm, ...DutchFieldPatterns.emailConfirm])],
  password: [...new Set([...EnglishFieldPatterns.password, ...DutchFieldPatterns.password])],
  birthdate: [...new Set([...EnglishFieldPatterns.birthdate, ...DutchFieldPatterns.birthdate])],
  gender: [...new Set([...EnglishFieldPatterns.gender, ...DutchFieldPatterns.gender])],
  birthDateDay: [...new Set([...EnglishFieldPatterns.birthDateDay, ...DutchFieldPatterns.birthDateDay])],
  birthDateMonth: [...new Set([...EnglishFieldPatterns.birthDateMonth, ...DutchFieldPatterns.birthDateMonth])],
  birthDateYear: [...new Set([...EnglishFieldPatterns.birthDateYear, ...DutchFieldPatterns.birthDateYear])],
  totp: [...new Set([...EnglishFieldPatterns.totp, ...DutchFieldPatterns.totp])]
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
 * email verification forms (not TOTP/2FA forms) by analyzing page content.
 */
export const CombinedEmailVerificationPatterns: EmailVerificationPatterns = {
  verifyEmail: [
    ...EnglishEmailVerificationPatterns.verifyEmail,
    ...DutchEmailVerificationPatterns.verifyEmail
  ],
  emailVerification: [
    ...EnglishEmailVerificationPatterns.emailVerification,
    ...DutchEmailVerificationPatterns.emailVerification
  ],
  sentCodeToEmail: [
    ...EnglishEmailVerificationPatterns.sentCodeToEmail,
    ...DutchEmailVerificationPatterns.sentCodeToEmail
  ],
  checkEmail: [
    ...EnglishEmailVerificationPatterns.checkEmail,
    ...DutchEmailVerificationPatterns.checkEmail
  ],
  confirmEmail: [
    ...EnglishEmailVerificationPatterns.confirmEmail,
    ...DutchEmailVerificationPatterns.confirmEmail
  ]
};
