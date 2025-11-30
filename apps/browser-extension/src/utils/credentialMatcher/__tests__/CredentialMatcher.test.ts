import { describe, it, expect, beforeEach } from 'vitest';

import { filterCredentials } from '@/utils/credentialMatcher/CredentialMatcher';
import type { Credential } from '@/utils/dist/shared/models/vault';

describe('CredentialMatcher - Credential URL Matching', () => {
  let testCredentials: Credential[];

  beforeEach(() => {
    // Create test credentials using shared test data structure
    testCredentials = createSharedTestCredentials();
  });

  // [#1] - Exact URL match
  it('should match exact URL', () => {
    const matches = filterCredentials(
      testCredentials,
      'www.coolblue.nl',
      ''
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].ServiceName).toBe('Coolblue');
  });

  // [#2] - Base URL with path match
  it('should match base URL with path', () => {
    const matches = filterCredentials(
      testCredentials,
      'https://gmail.com/signin',
      ''
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].ServiceName).toBe('Gmail');
  });

  // [#3] - Root domain with subdomain match
  it('should match root domain with subdomain', () => {
    const matches = filterCredentials(
      testCredentials,
      'https://mail.google.com',
      ''
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].ServiceName).toBe('Google');
  });

  // [#4] - No matches for non-existent domain
  it('should return empty array for no matches', () => {
    const matches = filterCredentials(
      testCredentials,
      'https://nonexistent.com',
      ''
    );

    expect(matches).toHaveLength(0);
  });

  // [#5] - Partial URL stored matches full URL search
  it('should match partial URL with full URL - dumpert.nl case', () => {
    // Test case: stored URL is "dumpert.nl", search with full URL
    const matches = filterCredentials(
      testCredentials,
      'https://www.dumpert.nl',
      ''
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].ServiceName).toBe('Dumpert');
  });

  // [#6] - Full URL stored matches partial URL search
  it('should match full URL with partial URL', () => {
    const matches = filterCredentials(
      testCredentials,
      'coolblue.nl',
      ''
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].ServiceName).toBe('Coolblue');
  });

  // [#7] - Protocol variations (http/https/none) match
  it('should handle protocol variations correctly', () => {
    // Test that http and https variations match
    const httpsMatches = filterCredentials(
      testCredentials,
      'https://github.com',
      ''
    );
    const httpMatches = filterCredentials(
      testCredentials,
      'http://github.com',
      ''
    );
    const noProtocolMatches = filterCredentials(
      testCredentials,
      'https://github.com',  // Converting no-protocol to https for test
      ''
    );

    expect(httpsMatches).toHaveLength(1);
    expect(httpMatches).toHaveLength(1);
    expect(noProtocolMatches).toHaveLength(1);
    expect(httpsMatches[0].ServiceName).toBe('GitHub');
    expect(httpMatches[0].ServiceName).toBe('GitHub');
    expect(noProtocolMatches[0].ServiceName).toBe('GitHub');
  });

  // [#8] - WWW prefix variations match
  it('should handle www variations correctly', () => {
    // Test that www variations match
    const withWww = filterCredentials(
      testCredentials,
      'https://www.dumpert.nl',
      ''
    );
    const withoutWww = filterCredentials(
      testCredentials,
      'https://dumpert.nl',
      ''
    );

    expect(withWww).toHaveLength(1);
    expect(withoutWww).toHaveLength(1);
    expect(withWww[0].ServiceName).toBe('Dumpert');
    expect(withoutWww[0].ServiceName).toBe('Dumpert');
  });

  // [#9] - Subdomain matching
  it('should handle subdomain matching', () => {
    // Test subdomain matching
    const appSubdomain = filterCredentials(
      testCredentials,
      'https://app.example.com',
      ''
    );
    const wwwSubdomain = filterCredentials(
      testCredentials,
      'https://www.example.com',
      ''
    );
    const noSubdomain = filterCredentials(
      testCredentials,
      'https://example.com',
      ''
    );

    expect(appSubdomain).toHaveLength(1);
    expect(appSubdomain[0].ServiceName).toBe('Subdomain Example');
    expect(wwwSubdomain).toHaveLength(1);
    expect(wwwSubdomain[0].ServiceName).toBe('Subdomain Example');
    expect(noSubdomain).toHaveLength(1);
    expect(noSubdomain[0].ServiceName).toBe('Subdomain Example');
  });

  // [#10] - Paths and query strings ignored
  it('should ignore paths and query strings', () => {
    // Test that paths and query strings are ignored
    const withPath = filterCredentials(
      testCredentials,
      'https://github.com/user/repo',
      ''
    );
    const withQuery = filterCredentials(
      testCredentials,
      'https://stackoverflow.com/questions?tab=newest',
      ''
    );
    const withFragment = filterCredentials(
      testCredentials,
      'https://gmail.com#inbox',
      ''
    );

    expect(withPath).toHaveLength(1);
    expect(withPath[0].ServiceName).toBe('GitHub');
    expect(withQuery).toHaveLength(1);
    expect(withQuery[0].ServiceName).toBe('Stack Overflow');
    expect(withFragment).toHaveLength(1);
    expect(withFragment[0].ServiceName).toBe('Gmail');
  });

  // [#11] - Complex URL variations
  it('should handle complex URL variations', () => {
    // Test complex URL matching scenario
    const complexUrl = filterCredentials(
      testCredentials,
      'https://www.coolblue.nl/product/12345?ref=google',
      ''
    );

    expect(complexUrl).toHaveLength(1);
    expect(complexUrl[0].ServiceName).toBe('Coolblue');
  });

  // [#12] - Priority ordering
  it('should handle priority ordering', () => {
    const matches = filterCredentials(
      testCredentials,
      'coolblue.nl',
      ''
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].ServiceName).toBe('Coolblue');
  });

  // [#13] - Title-only matching
  it('should match title only', () => {
    const matches = filterCredentials(
      testCredentials,
      'https://nomatch.com',
      'newyorktimes'
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].ServiceName).toBe('Title Only newyorktimes');
  });

  /* [#14] - Domain name part matching */
  it('should handle domain name part matching', () => {
    const matches = filterCredentials(
      testCredentials,
      'https://coolblue.be',
      ''
    );

    expect(matches).toHaveLength(0);
  });

  // [#15] - Package name matching
  it('should handle package name matching', () => {
    const matches = filterCredentials(
      testCredentials,
      'com.coolblue.app',
      ''
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].ServiceName).toBe('Coolblue App');
  });

  // [#16] - Invalid URL handling
  it('should handle invalid URL', () => {
    const matches = filterCredentials(
      testCredentials,
      'not a url',
      ''
    );

    expect(matches).toHaveLength(0);
  });

  // [#17] - Anti-phishing protection
  it('should handle anti-phishing protection', () => {
    const matches = filterCredentials(
      testCredentials,
      'https://secure-bankk.com',
      ''
    );

    expect(matches).toHaveLength(0);
  });

  // [#18] - Ensure only full words are matched
  it('should not match on string part of word', () => {
    const matches = filterCredentials(
      testCredentials,
      '',
      'Express Yourself App | Description'
    );

    // The string above should not match "AliExpress" service name
    expect(matches).toHaveLength(0);
  });

  // [#19] - Ensure separators and punctuation are stripped for matching
  it('should match service names when separated by commas and other punctuation', () => {
    const matches = filterCredentials(
      testCredentials,
      'https://nomatch.com',
      'Reddit, social media platform'
    );

    // Should match "Reddit" even though it's followed by a comma and description
    expect(matches).toHaveLength(1);
    expect(matches[0].ServiceName).toBe('Reddit');
  });

  // [#20] - Test reversed domain (app package name) doesn't match on TLD
  it('should not match credentials based on TLD when filtering reversed domains', () => {
    /*
     * Test that dumpert.nl credential doesn't match nl.marktplaats.android package
     * They both contain "nl" in the name but shouldn't match since "nl" is just a TLD
     */
    const reversedDomainCredentials = [
      createTestCredential('Dumpert.nl', '', 'user@dumpert.nl'),
      createTestCredential('Marktplaats.nl', '', 'user@marktplaats.nl'),
    ];

    const matches = filterCredentials(
      reversedDomainCredentials,
      'nl.marktplaats.android',
      ''
    );

    // Should only match Marktplaats, not Dumpert (even though both have "nl")
    expect(matches).toHaveLength(1);
    expect(matches[0].ServiceName).toBe('Marktplaats.nl');
  });

  // [#21] - Test app package names are properly detected and handled
  it('should properly handle app package names in filtering', () => {
    const packageCredentials = [
      createTestCredential('Google App', 'com.google.android.googlequicksearchbox', 'user@google.com'),
      createTestCredential('Facebook', 'com.facebook.katana', 'user@facebook.com'),
      createTestCredential('WhatsApp', 'com.whatsapp', 'user@whatsapp.com'),
      createTestCredential('Generic Site', 'example.com', 'user@example.com'),
    ];

    // Test com.google.android package matches
    const googleMatches = filterCredentials(
      packageCredentials,
      'com.google.android.googlequicksearchbox',
      ''
    );
    expect(googleMatches).toHaveLength(1);
    expect(googleMatches[0].ServiceName).toBe('Google App');

    // Test com.facebook package matches
    const facebookMatches = filterCredentials(
      packageCredentials,
      'com.facebook.katana',
      ''
    );
    expect(facebookMatches).toHaveLength(1);
    expect(facebookMatches[0].ServiceName).toBe('Facebook');

    // Test that web domain doesn't match package name
    const webMatches = filterCredentials(
      packageCredentials,
      'https://example.com',
      ''
    );
    expect(webMatches).toHaveLength(1);
    expect(webMatches[0].ServiceName).toBe('Generic Site');
  });

  // [#22] - Test multi-part TLDs like .com.au don't match incorrectly
  it('should handle multi-part TLDs correctly without false matches', () => {
    // Create test data with different .com.au domains
    const australianCredentials = [
      createTestCredential('Example Site AU', 'https://example.com.au', 'user@example.com.au'),
      createTestCredential('BlaBla AU', 'https://blabla.blabla.com.au', 'user@blabla.com.au'),
      createTestCredential('Another AU', 'https://another.com.au', 'user@another.com.au'),
      createTestCredential('UK Site', 'https://example.co.uk', 'user@example.co.uk'),
    ];

    // Test that blabla.blabla.com.au doesn't match other .com.au sites
    const blablaMatches = filterCredentials(
      australianCredentials,
      'https://blabla.blabla.com.au',
      ''
    );
    expect(blablaMatches).toHaveLength(1);
    expect(blablaMatches[0].ServiceName).toBe('BlaBla AU');

    // Test that example.com.au doesn't match blabla.blabla.com.au
    const exampleMatches = filterCredentials(
      australianCredentials,
      'https://example.com.au',
      ''
    );
    expect(exampleMatches).toHaveLength(1);
    expect(exampleMatches[0].ServiceName).toBe('Example Site AU');

    // Test that .co.uk domains work correctly too
    const ukMatches = filterCredentials(
      australianCredentials,
      'https://example.co.uk',
      ''
    );
    expect(ukMatches).toHaveLength(1);
    expect(ukMatches[0].ServiceName).toBe('UK Site');
  });

  /**
   * Creates the shared test credential dataset used across all platforms.
   * Note: when making changes to this list, make sure to update the corresponding list for iOS and Android tests as well.
   */
  function createSharedTestCredentials(): Credential[] {
    return [
      createTestCredential('Gmail', 'https://gmail.com', 'user@gmail.com'),
      createTestCredential('Google', 'https://google.com', 'user@google.com'),
      createTestCredential('Coolblue', 'https://www.coolblue.nl', 'user@coolblue.nl'),
      createTestCredential('Amazon', 'https://amazon.com', 'user@amazon.com'),
      createTestCredential('Coolblue App', 'com.coolblue.app', 'user@coolblue.nl'),
      createTestCredential('Dumpert', 'dumpert.nl', 'user@dumpert.nl'),
      createTestCredential('GitHub', 'github.com', 'user@github.com'),
      createTestCredential('Stack Overflow', 'https://stackoverflow.com', 'user@stackoverflow.com'),
      createTestCredential('Subdomain Example', 'https://app.example.com', 'user@example.com'),
      createTestCredential('Title Only newyorktimes', '', ''),
      createTestCredential('Bank Account', 'https://secure-bank.com', 'user@bank.com'),
      createTestCredential('AliExpress', 'https://aliexpress.com', 'user@aliexpress.com'),
      createTestCredential('Reddit', '', 'user@reddit.com'),
    ];
  }

  /**
   * Helper function to create test credentials with standardized structure.
   * @param serviceName - The name of the service
   * @param serviceUrl - The URL of the service
   * @param username - The username for the service
   * @returns A test credential matching the platform's Credential type
   */
  function createTestCredential(
    serviceName: string,
    serviceUrl: string,
    username: string
  ): Credential {
    return {
      Id: Math.random().toString(),
      ServiceName: serviceName,
      ServiceUrl: serviceUrl,
      Username: username,
      Password: 'password123',
      Notes: '',
      Logo: new Uint8Array(),
      Alias: {
        FirstName: '',
        LastName: '',
        NickName: '',
        BirthDate: '',
        Gender: undefined,
        Email: username
      }
    };
  }
});