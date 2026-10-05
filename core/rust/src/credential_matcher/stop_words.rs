//! Stop words for filtering page titles during credential matching.
//!

use std::collections::HashSet;
use std::sync::LazyLock;

/// [`STOP_WORDS`] as a set for constant-time lookup.
pub static STOP_WORD_SET: LazyLock<HashSet<&'static str>> = LazyLock::new(|| STOP_WORDS.iter().copied().collect());

/// Combined stop words from all supported languages (English + Dutch).
static STOP_WORDS: &[&str] = &[
    // English stop words

    // Authentication related
    "login", "signin", "sign", "register", "signup", "account",
    "authentication", "password", "access", "auth", "session",
    "authenticate", "credentials", "logout", "signout",

    // Navigation/Site sections
    "portal", "dashboard", "home", "welcome", "page", "site",
    "secure", "member", "user", "profile", "settings", "menu",
    "overview", "index", "main", "start", "landing",

    // Marketing/Promotional
    "free", "create", "your", "special", "offer",
    "deal", "discount", "promotion", "newsletter",

    // Common website sections
    "help", "support", "contact", "about", "terms",
    "privacy", "cookie", "service", "services", "products",
    "shop", "store", "cart", "checkout",

    // Generic descriptors
    "online", "digital", "mobile", "personal",
    "private", "general", "default", "standard", "website",

    // System/Technical
    "system", "admin", "administrator", "platform",
    "gateway", "interface", "console",

    // Time-related
    "today", "current", "latest", "newest", "recent",

    // Dutch stop words

    // Authentication related
    "inloggen", "registreren", "registratie", "aanmelden",
    "inschrijven", "uitloggen", "wachtwoord", "toegang",
    "authenticatie",

    // Navigation/Site sections
    "portaal", "overzicht", "startpagina", "welkom", "pagina",
    "beveiligd", "gebruiker", "profiel", "instellingen",
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
    "allemaal",
];
