//! Stop words for filtering page titles during credential matching.
//!
//! These words are filtered out to prevent generic terms from causing false positives.

/// Combined stop words from all supported languages (English + Dutch).
pub static STOP_WORDS: &[&str] = &[
    // ═══════════════════════════════════════════════════════════════════════════════
    // English Stop Words
    // ═══════════════════════════════════════════════════════════════════════════════

    // Authentication related
    "login", "signin", "sign", "register", "signup", "account",
    "authentication", "password", "access", "auth", "session",
    "authenticate", "credentials", "logout", "signout",

    // Navigation/Site sections
    "portal", "dashboard", "home", "welcome", "page", "site",
    "secure", "member", "user", "profile", "settings", "menu",
    "overview", "index", "main", "start", "landing",

    // Marketing/Promotional
    "free", "create", "new", "your", "special", "offer",
    "deal", "discount", "promotion", "newsletter",

    // Common website sections
    "help", "support", "contact", "about", "faq", "terms",
    "privacy", "cookie", "service", "services", "products",
    "shop", "store", "cart", "checkout",

    // Generic descriptors
    "online", "web", "digital", "mobile", "my", "personal",
    "private", "general", "default", "standard", "website",

    // System/Technical
    "system", "admin", "administrator", "platform",
    "gateway", "api", "interface", "console",

    // Time-related
    "today", "now", "current", "latest", "newest", "recent",

    // General
    "the", "and", "or", "but", "to", "up",

    // ═══════════════════════════════════════════════════════════════════════════════
    // Dutch Stop Words
    // ═══════════════════════════════════════════════════════════════════════════════

    // Authentication related
    "inloggen", "registreren", "registratie", "aanmelden",
    "inschrijven", "uitloggen", "wachtwoord", "toegang",
    "authenticatie",

    // Navigation/Site sections
    "portaal", "overzicht", "startpagina", "welkom", "pagina",
    "beveiligd", "lid", "gebruiker", "profiel", "instellingen",
    "begin", "hoofdpagina",

    // Marketing/Promotional
    "gratis", "nieuw", "jouw", "schrijf", "nieuwsbrief",
    "aanbieding", "korting", "speciaal", "actie",

    // Common website sections
    "hulp", "ondersteuning", "voorwaarden",
    "dienst", "diensten", "producten",
    "winkel", "bestellen", "winkelwagen",

    // Generic descriptors
    "digitaal", "mobiel", "mijn", "persoonlijk",
    "algemeen", "standaard",

    // System/Technical
    "systeem", "beheer", "beheerder",

    // Time-related
    "vandaag", "huidig", "nieuwste",

    // General
    "je", "in", "op", "de", "van", "ons", "allemaal",
];
