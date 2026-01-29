import XCTest
@testable import VaultStoreKit

final public class VaultStoreKitTests: XCTestCase {
    var vaultStore: VaultStore!
    let testEncryptionKeyBase64 = "/9So3C83JLDIfjsF0VQOc4rz1uAFtIseW7yrUuztAD0=" // 32 bytes for AES-256

    override public func setUp() {
        super.setUp()
        vaultStore = VaultStore.shared

        do {
            try vaultStore.storeEncryptionKey(base64Key: testEncryptionKeyBase64)

            let encryptedDb = try loadTestDatabase()
            try vaultStore.storeEncryptedDatabase(encryptedDb)

            let metadata = """
            {
                "publicEmailDomains": ["spamok.com", "spamok.nl"],
                "privateEmailDomains": ["aliasvault.net", "main.aliasvault.net"],
                "vaultRevisionNumber": 1
            }
            """
            try vaultStore.storeMetadata(metadata)

            try vaultStore.unlockVault()
        } catch {
            XCTFail("setUp failed with error: \(error)")
        }
    }

    override public func tearDown() {
        // Clean up after each test
        do {
           try vaultStore.clearVault()
        } catch {
          // Ignore.
        }
        super.tearDown()
    }

    func testDatabaseInitialization() async throws {
        // If we get here without throwing, initialization was successful
        XCTAssertTrue(vaultStore.isVaultUnlocked, "Vault should be unlocked after initialization")
    }

    func testGetAllItems() async throws {
        // Try to get all items
        let items = try vaultStore.getAllItems()

        // Verify we got some items back
        XCTAssertFalse(items.isEmpty, "Should have retrieved some items")

        // Verify the structure of the first item
        if let firstItem = items.first {
            XCTAssertNotNil(firstItem.id, "Item should have an ID")
            XCTAssertNotNil(firstItem.name, "Item should have a name")
            XCTAssertNotNil(firstItem.password, "Item should have a password")
        }
    }

    /**
     * This test verifies that the Gmail item details are correct including
     * the expected logo binary data.
     */
    func testGetGmailItemDetails() async throws {
        // Get all items
        let items = try vaultStore.getAllItems()

        // Find the Gmail item
        let gmailItem = items.first { $0.name == "Gmail Test Account" }
        XCTAssertNotNil(gmailItem, "Gmail Test Account item should exist")

        if let gmail = gmailItem {
            // Verify all expected properties
            XCTAssertEqual(gmail.name, "Gmail Test Account")
            XCTAssertEqual(gmail.url, "https://google.com")
            XCTAssertEqual(gmail.username, "test.user@gmail.com")
            XCTAssertEqual(gmail.firstName, "Test")
            XCTAssertEqual(gmail.lastName, "User")

            // Verify logo exists and has sufficient size
            XCTAssertNotNil(gmail.logo, "Item logo should not be nil")
            if let logoData = gmail.logo {
                XCTAssertGreaterThan(logoData.count, 1024, "Logo data should exceed 1KB in size")
            }
        }
    }

    // Helper method to load test database file
    private func loadTestDatabase() throws -> String {
        // Look in the root of the test bundle Resources
        guard let testDbPath = Bundle(for: type(of: self))
                .path(forResource: "test-encrypted-vault", ofType: "txt")
        else {
            throw NSError(domain: "VaultStoreKitTests",
                          code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Test database file not found"])
        }

        return try String(contentsOfFile: testDbPath, encoding: .utf8)
    }
}
