import type { Credential } from '@/utils/dist/shared/models/vault';
import { CombinedStopWords } from '@/utils/formDetector/FieldPatterns';

export enum AutofillMatchingMode {
  DEFAULT = 'default',
  URL_EXACT = 'url_exact',
  URL_SUBDOMAIN = 'url_subdomain'
}

type CredentialWithPriority = Credential & {
  priority: number;
}

/**
 * Extract domain from URL, handling both full URLs and partial domains
 * @param url - URL or domain string
 * @returns Normalized domain without protocol or www
 */
export function extractDomain(url: string): string {
  if (!url) {
    return '';
  }

  // Remove protocol if present
  let domain = url.toLowerCase().trim();
  domain = domain.replace(/^https?:\/\//, '');

  // Remove www. prefix
  domain = domain.replace(/^www\./, '');

  // Remove path, query, and fragment
  domain = domain.split('/')[0];
  domain = domain.split('?')[0];
  domain = domain.split('#')[0];

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
 * @param domain1 - First domain
 * @param domain2 - Second domain
 * @returns True if domains match (including partial matches)
 */
function domainsMatch(domain1: string, domain2: string): boolean {
  if (!domain1 || !domain2) {
    return false;
  }

  const d1 = extractDomain(domain1);
  const d2 = extractDomain(domain2);

  // Exact match
  if (d1 === d2) {
    return true;
  }

  // Check if one domain contains the other (for subdomain matching)
  if (d1.includes(d2) || d2.includes(d1)) {
    return true;
  }

  // Check root domain match
  const d1Root = extractRootDomain(d1);
  const d2Root = extractRootDomain(d2);

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
    // Replace common separators and punctuation with spaces
    .replace(/[|,;:\-–—/\\()[\]{}'"`~!@#$%^&*+=<>?]/g, ' ')
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
 * **Security Note**: When searching with a URL, text search fallback only applies to
 * credentials with no service URL defined. This prevents phishing attacks where a
 * malicious site might match credentials intended for the legitimate site.
 *
 * Credentials are sorted by priority:
 * 1. Exact domain match (priority 1 - highest)
 * 2. Partial/subdomain match (priority 2)
 * 3. Service name fallback match (priority 5 - lowest, only for credentials without URLs)
 */
export function filterCredentials(credentials: Credential[], currentUrl: string, pageTitle: string, matchingMode: AutofillMatchingMode = AutofillMatchingMode.DEFAULT): Credential[] {
  const filtered: CredentialWithPriority[] = [];
  const currentDomain = extractDomain(currentUrl);

  // Determine feature flags based on matching mode
  let enableExactMatch = false;
  let enableSubdomainMatch = false;
  let enableServiceNameFallback = false;

  switch (matchingMode) {
    case AutofillMatchingMode.URL_EXACT:
      enableExactMatch = true;
      enableSubdomainMatch = false;
      enableServiceNameFallback = false;
      break;

    case AutofillMatchingMode.URL_SUBDOMAIN:
      enableExactMatch = true;
      enableSubdomainMatch = true;
      enableServiceNameFallback = false;
      break;

    case AutofillMatchingMode.DEFAULT:
      enableExactMatch = true;
      enableSubdomainMatch = true;
      enableServiceNameFallback = true;
      break;
  }

  // Process credentials with service URLs
  credentials.forEach(cred => {
    if (!cred.ServiceUrl || cred.ServiceUrl.length === 0) {
      return; // Handle these in service name fallback
    }

    const credDomain = extractDomain(cred.ServiceUrl);

    // Check for exact match (priority 1)
    if (enableExactMatch && currentDomain === credDomain) {
      filtered.push({ ...cred, priority: 1 });
      return;
    }

    // Check for subdomain/partial match (priority 2)
    if (enableSubdomainMatch && domainsMatch(currentDomain, credDomain)) {
      filtered.push({ ...cred, priority: 2 });
      return;
    }
  });

  // Service name fallback for credentials without URLs (priority 5)
  if (enableServiceNameFallback) {
    /*
     * SECURITY: Service name matching only applies to credentials with no service URL.
     * This prevents phishing attacks where a malicious site might match credentials
     * intended for a legitimate site.
     */

    // Extract words from page title
    const titleWords = extractWords(pageTitle);

    if (titleWords.length > 0) {
      credentials.forEach(cred => {
        // CRITICAL: Only check credentials that have NO service URL defined
        if (cred.ServiceUrl && cred.ServiceUrl.length > 0) {
          return;
        }

        // Skip if already in filtered list
        if (filtered.some(f => f.Id === cred.Id)) {
          return;
        }

        // Check page title match with service name
        if (cred.ServiceName) {
          const credNameWords = extractWords(cred.ServiceName);

          /*
           * Match only complete words, not substrings
           * For example: "Express" should match "My Express Account" but not "AliExpress"
           */
          const hasTitleMatch = titleWords.some(titleWord =>
            credNameWords.some(credWord =>
              titleWord === credWord // Exact word match only
            )
          );

          if (hasTitleMatch) {
            filtered.push({ ...cred, priority: 5 });
          }
        }
      });
    }
  }

  // Sort by priority and return unique credentials (max 3)
  const uniqueCredentials = Array.from(
    new Map(
      filtered
        .sort((a, b) => a.priority - b.priority)
        .map(cred => [cred.Id, cred])
    ).values()
  );

  return uniqueCredentials.slice(0, 3);
}
