import XCTest
@testable import VaultUI
@testable import VaultModels

final class CredentialFilterTests: XCTestCase {
    private var testCredentials: [Credential] = []

    override func setUp() {
        super.setUp()

        // Create test credentials using shared test data structure
        testCredentials = createSharedTestCredentials()
    }

    override func tearDown() {
        testCredentials.removeAll()
        super.tearDown()
    }

    // [#1] - Exact URL match
    func testExactUrlMatch() {
        let matches = CredentialMatcher.filterCredentials(testCredentials, searchText: "www.coolblue.nl")

        XCTAssertEqual(matches.count, 1)
        XCTAssertEqual(matches.first?.service.name, "Coolblue")
    }

    // [#2] - Base URL with path match
    func testBaseUrlMatch() {
        let matches = CredentialMatcher.filterCredentials(testCredentials, searchText: "https://gmail.com/signin")

        XCTAssertEqual(matches.count, 1)
        XCTAssertEqual(matches.first?.service.name, "Gmail")
    }

    // [#3] - Root domain with subdomain match
    func testRootDomainMatch() {
        let matches = CredentialMatcher.filterCredentials(testCredentials, searchText: "https://mail.google.com")

        XCTAssertEqual(matches.count, 1)
        XCTAssertEqual(matches.first?.service.name, "Google")
    }

    // [#4] - No matches for non-existent domain
    func testNoMatches() {
        let matches = CredentialMatcher.filterCredentials(testCredentials, searchText: "https://nonexistent.com")

        XCTAssertTrue(matches.isEmpty)
    }

    // [#5] - Partial URL stored matches full URL search
    func testPartialUrlMatchWithFullUrl() {
        let matches = CredentialMatcher.filterCredentials(testCredentials, searchText: "https://www.dumpert.nl")

        XCTAssertEqual(matches.count, 1)
        XCTAssertEqual(matches.first?.service.name, "Dumpert")
    }

    // [#6] - Full URL stored matches partial URL search
    func testFullUrlMatchWithPartialUrl() {
        let matches = CredentialMatcher.filterCredentials(testCredentials, searchText: "coolblue.nl")

        XCTAssertEqual(matches.count, 1)
        XCTAssertTrue(matches.contains { $0.service.name == "Coolblue" })
    }

    // [#7] - Protocol variations (http/https/none) match
    func testProtocolVariations() {
        // Test that http and https variations match
        let httpsMatches = CredentialMatcher.filterCredentials(testCredentials, searchText: "https://github.com")
        let httpMatches = CredentialMatcher.filterCredentials(testCredentials, searchText: "http://github.com")
        let noProtocolMatches = CredentialMatcher.filterCredentials(testCredentials, searchText: "github.com")

        XCTAssertEqual(httpsMatches.count, 1)
        XCTAssertEqual(httpMatches.count, 1)
        XCTAssertEqual(noProtocolMatches.count, 1)
        XCTAssertEqual(httpsMatches.first?.service.name, "GitHub")
        XCTAssertEqual(httpMatches.first?.service.name, "GitHub")
        XCTAssertEqual(noProtocolMatches.first?.service.name, "GitHub")
    }

    // [#8] - WWW prefix variations match
    func testWwwVariations() {
        // Test that www variations match
        let withWww = CredentialMatcher.filterCredentials(testCredentials, searchText: "www.dumpert.nl")
        let withoutWww = CredentialMatcher.filterCredentials(testCredentials, searchText: "dumpert.nl")

        XCTAssertEqual(withWww.count, 1)
        XCTAssertEqual(withoutWww.count, 1)
        XCTAssertEqual(withWww.first?.service.name, "Dumpert")
        XCTAssertEqual(withoutWww.first?.service.name, "Dumpert")
    }

    // [#9] - Subdomain matching
    func testSubdomainMatching() {
        // Test subdomain matching
        let appSubdomain = CredentialMatcher.filterCredentials(testCredentials, searchText: "https://app.example.com")
        let wwwSubdomain = CredentialMatcher.filterCredentials(testCredentials, searchText: "https://www.example.com")
        let noSubdomain = CredentialMatcher.filterCredentials(testCredentials, searchText: "https://example.com")

        XCTAssertEqual(appSubdomain.count, 1)
        XCTAssertEqual(appSubdomain.first?.service.name, "Subdomain Example")
        XCTAssertEqual(wwwSubdomain.count, 1)
        XCTAssertEqual(wwwSubdomain.first?.service.name, "Subdomain Example")
        XCTAssertEqual(noSubdomain.count, 1)
        XCTAssertEqual(noSubdomain.first?.service.name, "Subdomain Example")
    }

    // [#10] - Paths and query strings ignored
    func testPathAndQueryIgnored() {
        // Test that paths and query strings are ignored
        let withPath = CredentialMatcher.filterCredentials(testCredentials, searchText: "https://github.com/user/repo")
        let withQuery = CredentialMatcher.filterCredentials(testCredentials, searchText: "https://stackoverflow.com/questions?tab=newest")
        let withFragment = CredentialMatcher.filterCredentials(testCredentials, searchText: "https://gmail.com#inbox")

        XCTAssertEqual(withPath.count, 1)
        XCTAssertEqual(withPath.first?.service.name, "GitHub")
        XCTAssertEqual(withQuery.count, 1)
        XCTAssertEqual(withQuery.first?.service.name, "Stack Overflow")
        XCTAssertEqual(withFragment.count, 1)
        XCTAssertEqual(withFragment.first?.service.name, "Gmail")
    }

    // [#11] - Complex URL variations
    func testComplexUrlVariations() {
        // Test complex URL matching scenario
        let matches = CredentialMatcher.filterCredentials(testCredentials, searchText: "https://www.coolblue.nl/product/12345?ref=google")

        XCTAssertEqual(matches.count, 1)
        XCTAssertTrue(matches.contains { $0.service.name == "Coolblue" })
    }

    // [#12] - Priority ordering
    func testPriorityOrdering() {
        let matches = CredentialMatcher.filterCredentials(testCredentials, searchText: "coolblue.nl")

        XCTAssertEqual(matches.count, 1)
        XCTAssertEqual(matches.first?.service.name, "Coolblue")
    }

    // [#13] - Title-only matching
    func testTitleOnlyMatching() {
        let matches = CredentialMatcher.filterCredentials(testCredentials, searchText: "newyorktimes")

        XCTAssertEqual(matches.count, 1)
        XCTAssertEqual(matches.first?.service.name, "Title Only newyorktimes")
    }

    // [#14] - Domain name part matching
    func testDomainNamePartMatch() {
        let matches = CredentialMatcher.filterCredentials(testCredentials, searchText: "https://coolblue.be")

        XCTAssertEqual(matches.count, 0)
    }

    // [#15] - Package name matching
    func testPackageNameMatch() {
        let matches = CredentialMatcher.filterCredentials(testCredentials, searchText: "com.coolblue.app")

        XCTAssertEqual(matches.count, 1)
        XCTAssertEqual(matches.first?.service.name, "Coolblue App")
    }

    // [#16] - Invalid URL handling
    func testInvalidUrl() {
        let matches = CredentialMatcher.filterCredentials(testCredentials, searchText: "not a url")

        XCTAssertTrue(matches.isEmpty)
    }

    // [#17] - Anti-phishing protection
    func testAntiPhishingProtection() {
        let matches = CredentialMatcher.filterCredentials(testCredentials, searchText: "https://secure-bankk.com")
        XCTAssertTrue(matches.isEmpty)
    }

    // [#18] - Ensure only full words are matched
    func testOnlyFullWordsMatch() {
        let matches = CredentialMatcher.filterCredentials(testCredentials, searchText: "Express Yourself App | Description")
        XCTAssertTrue(matches.isEmpty)
    }

    // [#19] - Ensure separators and punctuation are stripped for matching
    func testSeparatorsAndPunctuationStripped() {
        let matches = CredentialMatcher.filterCredentials(testCredentials, searchText: "Reddit, social media platform")

        // Should match "Coolblue" even though it's followed by a comma and description
        XCTAssertEqual(matches.count, 1)
        XCTAssertEqual(matches.first?.service.name, "Reddit")
    }

    // [#20] - Test multi-part TLDs like .com.au don't match incorrectly
    func testMultiPartTldNoFalseMatches() {
        // Create test data with different .com.au domains
        let australianCredentials = [
            createTestCredential(serviceName: "Example Site AU", serviceUrl: "https://example.com.au", username: "user@example.com.au"),
            createTestCredential(serviceName: "BlaBla AU", serviceUrl: "https://blabla.blabla.com.au", username: "user@blabla.com.au"),
            createTestCredential(serviceName: "Another AU", serviceUrl: "https://another.com.au", username: "user@another.com.au"),
            createTestCredential(serviceName: "UK Site", serviceUrl: "https://example.co.uk", username: "user@example.co.uk"),
        ]

        // Test that blabla.blabla.com.au doesn't match other .com.au sites
        let blablaMatches = CredentialMatcher.filterCredentials(australianCredentials, searchText: "https://blabla.blabla.com.au")
        XCTAssertEqual(blablaMatches.count, 1, "Should only match the exact domain, not all .com.au sites")
        XCTAssertEqual(blablaMatches.first?.service.name, "BlaBla AU")

        // Test that example.com.au doesn't match blabla.blabla.com.au
        let exampleMatches = CredentialMatcher.filterCredentials(australianCredentials, searchText: "https://example.com.au")
        XCTAssertEqual(exampleMatches.count, 1, "Should only match example.com.au")
        XCTAssertEqual(exampleMatches.first?.service.name, "Example Site AU")

        // Test that .co.uk domains work correctly too
        let ukMatches = CredentialMatcher.filterCredentials(australianCredentials, searchText: "https://example.co.uk")
        XCTAssertEqual(ukMatches.count, 1, "Should only match the .co.uk domain")
        XCTAssertEqual(ukMatches.first?.service.name, "UK Site")
    }

    // [#20] - Test reversed domain (app package name) doesn't match on TLD
    func testReversedDomainTldCheck() {
        // Test that dumpert.nl credential doesn't match nl.marktplaats.android package
        // They both contain "nl" in the name but shouldn't match since "nl" is just a TLD
        let reversedDomainCredentials = [
            createTestCredential(serviceName: "Dumpert.nl", serviceUrl: "", username: "user@dumpert.nl"),
            createTestCredential(serviceName: "Marktplaats.nl", serviceUrl: "", username: "user@marktplaats.nl"),
        ]

        let matches = CredentialMatcher.filterCredentials(reversedDomainCredentials, searchText: "nl.marktplaats.android")

        // Should only match Marktplaats, not Dumpert (even though both have "nl")
        XCTAssertEqual(matches.count, 1, "Should only match Marktplaats, not Dumpert")
        XCTAssertEqual(matches.first?.service.name, "Marktplaats.nl")
    }

    // [#21] - Test app package names are properly detected and handled
    func testAppPackageNameDetection() {
        let packageCredentials = [
            createTestCredential(serviceName: "Google App", serviceUrl: "com.google.android.googlequicksearchbox", username: "user@google.com"),
            createTestCredential(serviceName: "Facebook", serviceUrl: "com.facebook.katana", username: "user@facebook.com"),
            createTestCredential(serviceName: "WhatsApp", serviceUrl: "com.whatsapp", username: "user@whatsapp.com"),
            createTestCredential(serviceName: "Generic Site", serviceUrl: "example.com", username: "user@example.com"),
        ]

        // Test com.google.android package matches
        let googleMatches = CredentialMatcher.filterCredentials(packageCredentials, searchText: "com.google.android.googlequicksearchbox")
        XCTAssertEqual(googleMatches.count, 1)
        XCTAssertEqual(googleMatches.first?.service.name, "Google App")

        // Test com.facebook package matches
        let facebookMatches = CredentialMatcher.filterCredentials(packageCredentials, searchText: "com.facebook.katana")
        XCTAssertEqual(facebookMatches.count, 1)
        XCTAssertEqual(facebookMatches.first?.service.name, "Facebook")

        // Test that web domain doesn't match package name
        let webMatches = CredentialMatcher.filterCredentials(packageCredentials, searchText: "https://example.com")
        XCTAssertEqual(webMatches.count, 1)
        XCTAssertEqual(webMatches.first?.service.name, "Generic Site")
    }

    // MARK: - Shared Test Data

    /**
     * Creates the shared test credential dataset used across all platforms.
     * This ensures consistent testing across Browser Extension, iOS, and Android.
     */
    private func createSharedTestCredentials() -> [Credential] {
        return [
            createTestCredential(serviceName: "Gmail", serviceUrl: "https://gmail.com", username: "user@gmail.com"),
            createTestCredential(serviceName: "Google", serviceUrl: "https://google.com", username: "user@google.com"),
            createTestCredential(serviceName: "Coolblue", serviceUrl: "https://www.coolblue.nl", username: "user@coolblue.nl"),
            createTestCredential(serviceName: "Amazon", serviceUrl: "https://amazon.com", username: "user@amazon.com"),
            createTestCredential(serviceName: "Coolblue App", serviceUrl: "com.coolblue.app", username: "user@coolblue.nl"),
            createTestCredential(serviceName: "Dumpert", serviceUrl: "dumpert.nl", username: "user@dumpert.nl"),
            createTestCredential(serviceName: "GitHub", serviceUrl: "github.com", username: "user@github.com"),
            createTestCredential(serviceName: "Stack Overflow", serviceUrl: "https://stackoverflow.com", username: "user@stackoverflow.com"),
            createTestCredential(serviceName: "Subdomain Example", serviceUrl: "https://app.example.com", username: "user@example.com"),
            createTestCredential(serviceName: "Title Only newyorktimes", serviceUrl: "", username: ""),
            createTestCredential(serviceName: "Bank Account", serviceUrl: "https://secure-bank.com", username: "user@bank.com"),
            createTestCredential(serviceName: "AliExpress", serviceUrl: "https://aliexpress.com", username: "user@aliexpress.com"),
            createTestCredential(serviceName: "Reddit", serviceUrl: "", username: "user@reddit.com"),
        ]
    }

    /**
     * Helper function to create test credentials with standardized structure.
     * @param serviceName The name of the service
     * @param serviceUrl The URL of the service
     * @param username The username for the service
     * @returns A test credential matching the iOS Credential type
     */
    private func createTestCredential(
        serviceName: String,
        serviceUrl: String,
        username: String
    ) -> Credential {
        return Credential(
            id: UUID(),
            alias: nil, service: Service(
                id: UUID(),
                name: serviceName,
                url: serviceUrl,
                logo: nil,
                createdAt: Date(),
                updatedAt: Date(),
                isDeleted: false
            ),
            username: username,
            notes: nil, password: Password(
                id: UUID(), credentialId: UUID(),
                value: "password123",
                createdAt: Date(),
                updatedAt: Date(),
                isDeleted: false
            ),
            createdAt: Date(),
            updatedAt: Date(),
            isDeleted: false
        )
    }
}
