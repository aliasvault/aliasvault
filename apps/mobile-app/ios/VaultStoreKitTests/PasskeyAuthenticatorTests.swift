import XCTest
@testable import VaultStoreKit

final class PasskeyAuthenticatorTests: XCTestCase {

    override func setUp() {
        super.setUp()
    }

    override func tearDown() {
        super.tearDown()
    }

    /**
     * Test that PasskeyAuthenticator can successfully create a passkey
     * This validates the entire flow including key generation, CBOR encoding, and JWK export
     */
    func testCreatePasskey() throws {
        print("PasskeyAuthenticatorTests: Starting passkey creation test")

        // Test data
        let rpId = "example.com"
        let userName = "testuser@example.com"
        let userDisplayName = "Test User"
        let userId = Data("test-user-id".utf8)
        let clientDataHash = Data(repeating: 0xAB, count: 32) // Mock 32-byte hash
        let credentialId = Data(repeating: 0x12, count: 16) // Mock 16-byte credential ID

        print("PasskeyAuthenticatorTests: Test parameters:")
        print("  - rpId: \(rpId)")
        print("  - userName: \(userName ?? "nil")")
        print("  - userId: \(userId.base64EncodedString())")
        print("  - clientDataHash: \(clientDataHash.count) bytes")
        print("  - credentialId: \(credentialId.count) bytes")

        // Attempt to create the passkey
        let result: PasskeyCreationResult
        do {
            result = try PasskeyAuthenticator.createPasskey(
                credentialId: credentialId,
                clientDataHash: clientDataHash,
                rpId: rpId,
                userId: userId,
                userName: userName,
                userDisplayName: userDisplayName,
                uvPerformed: true,
                enablePrf: false
            )
            print("PasskeyAuthenticatorTests: ✅ Passkey created successfully")
        } catch {
            XCTFail("Failed to create passkey: \(error)")
            return
        }

        // Validate the result
        print("PasskeyAuthenticatorTests: Validating result...")

        // Check credential ID
        XCTAssertEqual(result.credentialId, credentialId, "Credential ID should match input")
        print("  ✅ Credential ID matches")

        // Check attestation object exists and has reasonable size
        XCTAssertGreaterThan(result.attestationObject.count, 50, "Attestation object should be at least 50 bytes")
        print("  ✅ Attestation object size: \(result.attestationObject.count) bytes")

        // Check public key JWK
        XCTAssertGreaterThan(result.publicKey.count, 0, "Public key JWK should not be empty")
        print("  ✅ Public key JWK size: \(result.publicKey.count) bytes")

        // Validate public key JWK structure
        if let publicKeyJson = try? JSONSerialization.jsonObject(with: result.publicKey) as? [String: Any] {
            XCTAssertEqual(publicKeyJson["kty"] as? String, "EC", "Key type should be EC")
            XCTAssertEqual(publicKeyJson["crv"] as? String, "P-256", "Curve should be P-256")
            XCTAssertNotNil(publicKeyJson["x"], "Public key should have x coordinate")
            XCTAssertNotNil(publicKeyJson["y"], "Public key should have y coordinate")
            print("  ✅ Public key JWK structure is valid")
        } else {
            XCTFail("Public key should be valid JSON")
        }

        // Check private key JWK
        XCTAssertGreaterThan(result.privateKey.count, 0, "Private key JWK should not be empty")
        print("  ✅ Private key JWK size: \(result.privateKey.count) bytes")

        // Validate private key JWK structure
        if let privateKeyJson = try? JSONSerialization.jsonObject(with: result.privateKey) as? [String: Any] {
            XCTAssertEqual(privateKeyJson["kty"] as? String, "EC", "Key type should be EC")
            XCTAssertEqual(privateKeyJson["crv"] as? String, "P-256", "Curve should be P-256")
            XCTAssertNotNil(privateKeyJson["x"], "Private key should have x coordinate")
            XCTAssertNotNil(privateKeyJson["y"], "Private key should have y coordinate")
            XCTAssertNotNil(privateKeyJson["d"], "Private key should have d value")
            print("  ✅ Private key JWK structure is valid")
        } else {
            XCTFail("Private key should be valid JSON")
        }

        // Check RP ID
        XCTAssertEqual(result.rpId, rpId, "RP ID should match input")
        print("  ✅ RP ID matches")

        // Check user ID
        XCTAssertEqual(result.userId, userId, "User ID should match input")
        print("  ✅ User ID matches")

        // Check user name
        XCTAssertEqual(result.userName, userName, "User name should match input")
        print("  ✅ User name matches")

        // Check user display name
        XCTAssertEqual(result.userDisplayName, userDisplayName, "User display name should match input")
        print("  ✅ User display name matches")

        // Check PRF secret (should be nil since enablePrf = false)
        XCTAssertNil(result.prfSecret, "PRF secret should be nil when not enabled")
        print("  ✅ PRF secret is nil (as expected)")

        print("PasskeyAuthenticatorTests: ✅ All validations passed!")
    }

    /**
     * Test passkey creation with PRF extension enabled
     */
    func testCreatePasskeyWithPrf() throws {
        print("PasskeyAuthenticatorTests: Starting passkey creation test with PRF")

        let rpId = "example.com"
        let clientDataHash = Data(repeating: 0xAB, count: 32)
        let credentialId = Data(repeating: 0x12, count: 16)

        let result = try PasskeyAuthenticator.createPasskey(
            credentialId: credentialId,
            clientDataHash: clientDataHash,
            rpId: rpId,
            userId: nil,
            userName: nil,
            userDisplayName: nil,
            uvPerformed: true,
            enablePrf: true
        )

        // Check PRF secret exists
        XCTAssertNotNil(result.prfSecret, "PRF secret should exist when enabled")
        XCTAssertEqual(result.prfSecret?.count, 32, "PRF secret should be 32 bytes")
        print("  ✅ PRF secret generated: \(result.prfSecret!.count) bytes")

        print("PasskeyAuthenticatorTests: ✅ PRF test passed!")
    }

    /**
     * Test passkey creation with minimal parameters
     */
    func testCreatePasskeyMinimal() throws {
        print("PasskeyAuthenticatorTests: Starting minimal passkey creation test")

        let rpId = "example.com"
        let clientDataHash = Data(repeating: 0xAB, count: 32)
        let credentialId = Data(repeating: 0x12, count: 16)

        let result = try PasskeyAuthenticator.createPasskey(
            credentialId: credentialId,
            clientDataHash: clientDataHash,
            rpId: rpId,
            userId: nil,
            userName: nil,
            userDisplayName: nil,
            uvPerformed: false,
            enablePrf: false
        )

        XCTAssertEqual(result.credentialId, credentialId)
        XCTAssertGreaterThan(result.attestationObject.count, 0)
        XCTAssertGreaterThan(result.publicKey.count, 0)
        XCTAssertGreaterThan(result.privateKey.count, 0)
        XCTAssertEqual(result.rpId, rpId)
        XCTAssertNil(result.userId)
        XCTAssertNil(result.userName)
        XCTAssertNil(result.userDisplayName)
        XCTAssertNil(result.prfSecret)

        print("PasskeyAuthenticatorTests: ✅ Minimal test passed!")
    }
}
