import type { Credential } from '@/utils/dist/shared/models/vault';
import { CombinedStopWords } from '@/utils/formDetector/FieldPatterns';

/**
 * Credential filtering for browser extension autofill.
 * This implementation follows the unified filtering algorithm specification defined in
 * docs/CREDENTIAL_FILTERING_SPEC.md for cross-platform consistency with Android and iOS.
 *
 * Algorithm Structure (Priority Order with Early Returns):
 * 1. PRIORITY 1: App Package Name Exact Match (included for consistency, not used in browser)
 * 2. PRIORITY 2: URL Domain Matching (exact, subdomain, root domain)
 * 3. PRIORITY 3: Service Name Fallback (only for credentials without URLs - anti-phishing)
 * 4. PRIORITY 4: Text/Page Title Matching (non-URL search)
 */

export enum AutofillMatchingMode {
  DEFAULT = 'default',
  URL_EXACT = 'url_exact',
  URL_SUBDOMAIN = 'url_subdomain'
}

type CredentialWithPriority = Credential & {
  priority: number;
}

/**
 * Common top-level domains (TLDs) used for app package name detection.
 * When a search string starts with one of these TLDs followed by a dot (e.g., "com.coolblue.app"),
 * it's identified as a reversed domain name (app package name) rather than a regular URL.
 * Note: This is included for cross-platform test consistency but not actively used in browser context.
 */
const COMMON_TLDS = new Set([
  // Generic TLDs
  'com', 'net', 'org', 'edu', 'gov', 'mil', 'int',
  // Country code TLDs
  'nl', 'de', 'uk', 'fr', 'it', 'es', 'pl', 'be', 'ch', 'at', 'se', 'no', 'dk', 'fi',
  'pt', 'gr', 'cz', 'hu', 'ro', 'bg', 'hr', 'sk', 'si', 'lt', 'lv', 'ee', 'ie', 'lu',
  'us', 'ca', 'mx', 'br', 'ar', 'cl', 'co', 've', 'pe', 'ec',
  'au', 'nz', 'jp', 'cn', 'in', 'kr', 'tw', 'hk', 'sg', 'my', 'th', 'id', 'ph', 'vn',
  'za', 'eg', 'ng', 'ke', 'ug', 'tz', 'ma',
  'ru', 'ua', 'by', 'kz', 'il', 'tr', 'sa', 'ae', 'qa', 'kw',
  // New gTLDs (common ones)
  'app', 'dev', 'io', 'ai', 'tech', 'shop', 'store', 'online', 'site', 'website',
  'blog', 'news', 'media', 'tv', 'video', 'music', 'pro', 'info', 'biz', 'name'
]);

/**
 * Check if a string is likely an app package name (reversed domain).
 * Package names start with TLD followed by dot (e.g., "com.example", "nl.app").
 * @param text - Text to check
 * @returns True if it looks like an app package name
 */
function isAppPackageName(text: string): boolean {
  // Must contain a dot
  if (!text.includes('.')) {
    return false;
  }

  // Must not have protocol
  if (text.startsWith('http://') || text.startsWith('https://')) {
    return false;
  }

  // Extract first part before first dot
  const firstPart = text.split('.')[0].toLowerCase();

  // Check if first part is a common TLD - indicates reversed domain (package name)
  return COMMON_TLDS.has(firstPart);
}

/**
 * Extract domain from URL, handling both full URLs and partial domains
 * @param url - URL or domain string
 * @returns Normalized domain without protocol or www, or empty string if not a valid URL/domain
 */
export function extractDomain(url: string): string {
  if (!url) {
    return '';
  }

  let domain = url.toLowerCase().trim();

  // Check if it has a protocol
  const hasProtocol = domain.startsWith('http://') || domain.startsWith('https://');

  /*
   * If no protocol and starts with TLD + dot, it's likely an app package name
   * Return empty string to indicate that domain extraction has failed for this string
   */
  if (!hasProtocol && isAppPackageName(domain)) {
    return '';
  }

  // Remove protocol if present
  domain = domain.replace(/^https?:\/\//, '');

  // Remove www. prefix
  domain = domain.replace(/^www\./, '');

  // Remove path, query, and fragment
  domain = domain.split('/')[0];
  domain = domain.split('?')[0];
  domain = domain.split('#')[0];

  // Basic domain validation - must contain at least one dot and valid characters
  if (!domain.includes('.') || !/^[a-z0-9.-]+$/.test(domain)) {
    return '';
  }

  // Ensure valid domain structure
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) {
    return '';
  }

  return domain;
}

/**
 * Extract root domain from a domain string.
 * E.g., "sub.example.com" -> "example.com"
 * E.g., "sub.example.com.au" -> "example.com.au"
 * E.g., "sub.example.co.uk" -> "example.co.uk"
 */
export function extractRootDomain(domain: string): string {
  const parts = domain.split('.');
  if (parts.length < 2) {
    return domain;
  }

  // Common two-level public TLDs
  const twoLevelTlds = new Set([
    // Australia
    'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
    // United Kingdom
    'co.uk', 'org.uk', 'net.uk', 'ac.uk', 'gov.uk', 'plc.uk', 'ltd.uk', 'me.uk',
    // Canada
    'co.ca', 'net.ca', 'org.ca', 'gc.ca', 'ab.ca', 'bc.ca', 'mb.ca', 'nb.ca', 'nf.ca', 'nl.ca', 'ns.ca', 'nt.ca', 'nu.ca',
    'on.ca', 'pe.ca', 'qc.ca', 'sk.ca', 'yk.ca',
    // India
    'co.in', 'net.in', 'org.in', 'edu.in', 'gov.in', 'ac.in', 'res.in', 'gen.in', 'firm.in', 'ind.in',
    // Japan
    'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'ad.jp', 'ed.jp', 'go.jp', 'gr.jp', 'lg.jp',
    // South Africa
    'co.za', 'net.za', 'org.za', 'edu.za', 'gov.za', 'ac.za', 'web.za',
    // New Zealand
    'co.nz', 'net.nz', 'org.nz', 'edu.nz', 'govt.nz', 'ac.nz', 'geek.nz', 'gen.nz', 'kiwi.nz', 'maori.nz', 'mil.nz', 'school.nz',
    // Brazil
    'com.br', 'net.br', 'org.br', 'edu.br', 'gov.br', 'mil.br', 'art.br', 'etc.br', 'adv.br', 'arq.br', 'bio.br', 'cim.br',
    'cng.br', 'cnt.br', 'ecn.br', 'eng.br', 'esp.br', 'eti.br', 'far.br', 'fnd.br', 'fot.br', 'fst.br', 'g12.br', 'geo.br',
    'ggf.br', 'jor.br', 'lel.br', 'mat.br', 'med.br', 'mus.br', 'not.br', 'ntr.br', 'odo.br', 'ppg.br', 'pro.br', 'psc.br',
    'psi.br', 'qsl.br', 'rec.br', 'slg.br', 'srv.br', 'tmp.br', 'trd.br', 'tur.br', 'tv.br', 'vet.br', 'zlg.br',
    // Russia
    'com.ru', 'net.ru', 'org.ru', 'edu.ru', 'gov.ru', 'int.ru', 'mil.ru', 'spb.ru', 'msk.ru',
    // China
    'com.cn', 'net.cn', 'org.cn', 'edu.cn', 'gov.cn', 'mil.cn', 'ac.cn', 'ah.cn', 'bj.cn', 'cq.cn', 'fj.cn', 'gd.cn', 'gs.cn',
    'gz.cn', 'gx.cn', 'ha.cn', 'hb.cn', 'he.cn', 'hi.cn', 'hk.cn', 'hl.cn', 'hn.cn', 'jl.cn', 'js.cn', 'jx.cn', 'ln.cn', 'mo.cn',
    'nm.cn', 'nx.cn', 'qh.cn', 'sc.cn', 'sd.cn', 'sh.cn', 'sn.cn', 'sx.cn', 'tj.cn', 'tw.cn', 'xj.cn', 'xz.cn', 'yn.cn', 'zj.cn',
    // Mexico
    'com.mx', 'net.mx', 'org.mx', 'edu.mx', 'gob.mx',
    // Argentina
    'com.ar', 'net.ar', 'org.ar', 'edu.ar', 'gov.ar', 'mil.ar', 'int.ar',
    // Chile
    'com.cl', 'net.cl', 'org.cl', 'edu.cl', 'gov.cl', 'mil.cl',
    // Colombia
    'com.co', 'net.co', 'org.co', 'edu.co', 'gov.co', 'mil.co', 'nom.co',
    // Venezuela
    'com.ve', 'net.ve', 'org.ve', 'edu.ve', 'gov.ve', 'mil.ve', 'web.ve',
    // Peru
    'com.pe', 'net.pe', 'org.pe', 'edu.pe', 'gob.pe', 'mil.pe', 'nom.pe',
    // Ecuador
    'com.ec', 'net.ec', 'org.ec', 'edu.ec', 'gov.ec', 'mil.ec', 'med.ec', 'fin.ec', 'pro.ec', 'info.ec',
    // Europe
    'co.at', 'or.at', 'ac.at', 'gv.at', 'priv.at',
    'co.be', 'ac.be',
    'co.dk', 'ac.dk',
    'co.il', 'net.il', 'org.il', 'ac.il', 'gov.il', 'idf.il', 'k12.il', 'muni.il',
    'co.no', 'ac.no', 'priv.no',
    'co.pl', 'net.pl', 'org.pl', 'edu.pl', 'gov.pl', 'mil.pl', 'nom.pl', 'com.pl',
    'co.th', 'net.th', 'org.th', 'edu.th', 'gov.th', 'mil.th', 'ac.th', 'in.th',
    'co.kr', 'net.kr', 'org.kr', 'edu.kr', 'gov.kr', 'mil.kr', 'ac.kr', 'go.kr', 'ne.kr', 'or.kr', 'pe.kr', 're.kr', 'seoul.kr',
    'kyonggi.kr',
    // Others
    'co.id', 'net.id', 'org.id', 'edu.id', 'gov.id', 'mil.id', 'web.id', 'ac.id', 'sch.id',
    'co.ma', 'net.ma', 'org.ma', 'edu.ma', 'gov.ma', 'ac.ma', 'press.ma',
    'co.ke', 'net.ke', 'org.ke', 'edu.ke', 'gov.ke', 'ac.ke', 'go.ke', 'info.ke', 'me.ke', 'mobi.ke', 'sc.ke',
    'co.ug', 'net.ug', 'org.ug', 'edu.ug', 'gov.ug', 'ac.ug', 'sc.ug', 'go.ug', 'ne.ug', 'or.ug',
    'co.tz', 'net.tz', 'org.tz', 'edu.tz', 'gov.tz', 'ac.tz', 'go.tz', 'hotel.tz', 'info.tz', 'me.tz', 'mil.tz', 'mobi.tz',
    'ne.tz', 'or.tz', 'sc.tz', 'tv.tz',
  ]);

  // Check if the last two parts form a known two-level TLD
  if (parts.length >= 3) {
    const lastTwoParts = parts.slice(-2).join('.');
    if (twoLevelTlds.has(lastTwoParts)) {
      // Take the last three parts for two-level TLDs
      return parts.slice(-3).join('.');
    }
  }

  // Default to last two parts for regular TLDs
  return parts.length >= 2 ? parts.slice(-2).join('.') : domain;
}

/**
 * Check if two domains match, supporting partial matches
 * Note: Both parameters should be pre-extracted domains (without protocol, www, path, etc.)
 * @param domain1 - First domain (pre-extracted)
 * @param domain2 - Second domain (pre-extracted)
 * @returns True if domains match (including partial matches)
 */
function domainsMatch(domain1: string, domain2: string): boolean {
  if (!domain1 || !domain2) {
    return false;
  }

  // Exact match
  if (domain1 === domain2) {
    return true;
  }

  // Check if one domain contains the other (for subdomain matching)
  if (domain1.includes(domain2) || domain2.includes(domain1)) {
    return true;
  }

  // Check root domain match
  const d1Root = extractRootDomain(domain1);
  const d2Root = extractRootDomain(domain2);

  return d1Root === d2Root;
}

/**
 * Extract meaningful words from text, removing punctuation and filtering stop words
 * @param text - Text to extract words from
 * @returns Array of filtered words
 */
function extractWords(text: string): string[] {
  if (!text || text.length === 0) {
    return [];
  }

  return text.toLowerCase()
    // Replace common separators and punctuation with spaces (including dots)
    .replace(/[|,;:\-–—/\\()[\]{}'"`~!@#$%^&*+=<>?.]/g, ' ')
    // Split on whitespace and filter
    .split(/\s+/)
    .filter(word =>
      word.length > 3 &&
      !CombinedStopWords.has(word)
    );
}

/**
 * Filter credentials based on current URL and page context with anti-phishing protection.
 *
 * This method follows a strict priority-based algorithm with early returns:
 * 1. PRIORITY 1: App Package Name Exact Match (highest priority, included for consistency)
 * 2. PRIORITY 2: URL Domain Matching
 * 3. PRIORITY 3: Service Name Fallback (anti-phishing protection)
 * 4. PRIORITY 4: Text/Page Title Matching (lowest priority)
 *
 * @param credentials - List of credentials to filter
 * @param currentUrl - Current page URL
 * @param pageTitle - Current page title
 * @param matchingMode - Matching mode (controls subdomain and fallback behavior)
 * @returns Filtered list of credentials (max 3)
 *
 * **Security Note**: Priority 3 only searches credentials with no service URL defined.
 * This prevents phishing attacks where a malicious site might match credentials
 * intended for a legitimate site.
 */
export function filterCredentials(credentials: Credential[], currentUrl: string, pageTitle: string, matchingMode: AutofillMatchingMode = AutofillMatchingMode.DEFAULT): Credential[] {
  // Early return for empty URL
  if (!currentUrl) {
    return [];
  }

  /*
   * ═══════════════════════════════════════════════════════════════════════════════
   * PRIORITY 1: App Package Name Exact Match
   * Check if current URL is an app package name (e.g., com.coolblue.app)
   * Note: Not used in browser context but included for cross-platform test consistency
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  const isPackageName = isAppPackageName(currentUrl);
  if (isPackageName) {
    // Perform exact string match on ServiceUrl field
    const packageMatches = credentials.filter(cred =>
      cred.ServiceUrl && cred.ServiceUrl.length > 0 && currentUrl === cred.ServiceUrl
    );

    // EARLY RETURN if matches found
    if (packageMatches.length > 0) {
      return packageMatches.slice(0, 3);
    }
    /*
     * If no matches found, skip URL matching and go directly to text matching (Priority 4)
     * Package names shouldn't be treated as URLs
     */
  }

  /*
   * ═══════════════════════════════════════════════════════════════════════════════
   * PRIORITY 2: URL Domain Matching
   * Try to extract domain from current URL (skip if package name)
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  if (!isPackageName) {
    const currentDomain = extractDomain(currentUrl);

    if (currentDomain) {
      const filtered: CredentialWithPriority[] = [];

      // Determine matching features based on mode
      const enableExactMatch = matchingMode !== undefined;
      const enableSubdomainMatch = matchingMode === AutofillMatchingMode.DEFAULT || matchingMode === AutofillMatchingMode.URL_SUBDOMAIN;

      // Process credentials with service URLs
      for (const cred of credentials) {
        if (!cred.ServiceUrl || cred.ServiceUrl.length === 0) {
          continue; // Handle these in Priority 3
        }

        const credDomain = extractDomain(cred.ServiceUrl);

        // Check for exact match (priority 1)
        if (enableExactMatch && currentDomain === credDomain) {
          filtered.push({ ...cred, priority: 1 });
          continue;
        }

        // Check for subdomain/partial match (priority 2)
        if (enableSubdomainMatch && domainsMatch(currentDomain, credDomain)) {
          filtered.push({ ...cred, priority: 2 });
        }
      }

      // EARLY RETURN if matches found
      if (filtered.length > 0) {
        const uniqueCredentials = Array.from(
          new Map(
            filtered
              .sort((a, b) => a.priority - b.priority)
              .map(cred => [cred.Id, cred])
          ).values()
        );
        return uniqueCredentials.slice(0, 3);
      }

      /*
       * ═══════════════════════════════════════════════════════════════════════════
       * PRIORITY 3: Page Title / Service Name Fallback (Anti-Phishing Protection)
       * No domain matches found - search in service names using page title
       * CRITICAL: Only search credentials with NO service URL defined
       * ═══════════════════════════════════════════════════════════════════════════
       */
      if (pageTitle) {
        const titleWords = extractWords(pageTitle);

        if (titleWords.length > 0) {
          const nameMatches: Credential[] = [];

          for (const cred of credentials) {
          // SECURITY: Skip credentials that have a URL defined
            if (cred.ServiceUrl && cred.ServiceUrl.length > 0) {
              continue;
            }

            // Check page title match with service name
            if (cred.ServiceName) {
              const credNameWords = extractWords(cred.ServiceName);

              /*
               * Match only complete words, not substrings
               * For example: "Express" should match "My Express Account" but not "AliExpress"
               */
              const hasTitleMatch = titleWords.some(titleWord =>
                credNameWords.some(credWord => titleWord === credWord)
              );

              if (hasTitleMatch) {
                nameMatches.push(cred);
              }
            }
          }

          // Return matches from Priority 3 if any found
          if (nameMatches.length > 0) {
            return nameMatches.slice(0, 3);
          }
        }
      }

      // No matches found in Priority 2 or Priority 3
      return [];
    }
  } // End of Priority 2 (!isPackageName)

  /*
   * ═══════════════════════════════════════════════════════════════════════════════
   * PRIORITY 4: Text Matching
   * Used when: 1) Package name didn't match in Priority 1, OR 2) URL extraction failed
   * Performs word-based matching on service names
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  const searchWords = extractWords(currentUrl);

  if (searchWords.length > 0) {
    return credentials.filter(cred => {
      const serviceNameWords = cred.ServiceName ? extractWords(cred.ServiceName) : [];

      // Check if any search word matches any service name word exactly
      return searchWords.some(searchWord =>
        serviceNameWords.includes(searchWord)
      );
    }).slice(0, 3);
  }

  // No matches found
  return [];
}
