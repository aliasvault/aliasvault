import Foundation
import CryptoKit
import Security

/**
 * PasskeyAuthenticator
 * -------------------------
 * A WebAuthn "virtual authenticator" for iOS credential provider extension.
 * Implements passkey creation (registration) and authentication (assertion) following
 * the WebAuthn Level 2 specification.
 *
 * This is a port of the browser extension PasskeyAuthenticator.ts to native Swift.
 * TODO: review implementation and docs.
 *
 * Key features:
 * - ES256 (ECDSA P-256) key pair generation
 * - CBOR/COSE encoding for attestation objects
 * - Proper authenticator data with WebAuthn flags
 * - Self-attestation (packed format) or none attestation
 * - Consistent base64url handling
 * - Sign count always 0 for syncable passkeys
 * - BE/BS flags for backup-eligible and backed-up status
 */
public class PasskeyAuthenticator {

    /// AliasVault AAGUID: a11a5vau-9f32-4b8c-8c5d-2f7d13e8c942
    private static let aaguid: [UInt8] = [
        0xa1, 0x1a, 0x5f, 0xaa, 0x9f, 0x32, 0x4b, 0x8c,
        0x8c, 0x5d, 0x2f, 0x7d, 0x13, 0xe8, 0xc9, 0x42
    ]

    // MARK: - Public API

    /**
     * Create a new passkey (registration)
     * Returns credential data ready for iOS to return to the RP, plus storage data
     *
     * - Note: This method intentionally has more than 5 parameters to match WebAuthn spec requirements.
     *         SwiftLint: function_parameter_count is disabled for this method as parameters directly map
     *         to WebAuthn credential creation parameters and cannot be reasonably grouped.
     */
    // swiftlint:disable:next function_parameter_count
    public static func createPasskey(
        credentialId: Data,
        clientDataHash: Data,
        rpId: String,
        userId: Data?,
        userName: String?,
        userDisplayName: String?,
        uvPerformed: Bool = false,
        enablePrf: Bool = false
    ) throws -> PasskeyCreationResult {

        // 1. Generate ES256 key pair
        let privateKey = P256.Signing.PrivateKey()
        let publicKey = privateKey.publicKey

        // 2. RP ID hash
        let rpIdHash = Data(SHA256.hash(data: rpId.data(using: .utf8)!))

        // 3. Build flags
        var flags: UInt8 = 0x41  // UP (bit 0) + AT (bit 6)
        if uvPerformed {
            flags |= 0x04  // UV (bit 2)
        }
        flags |= 0x08  // BE (bit 3) - backup eligible
        flags |= 0x10  // BS (bit 4) - backup state

        // 4. Sign count (always 0 for syncable credentials)
        let signCount = Data([0x00, 0x00, 0x00, 0x00])

        // 5. Build COSE public key
        let coseKey = try buildCoseEc2Es256(publicKey: publicKey)

        // 6. Build attested credential data
        let credIdLength = Data([
            UInt8((credentialId.count >> 8) & 0xFF),
            UInt8(credentialId.count & 0xFF)
        ])
        var attestedCredData = Data(aaguid)
        attestedCredData.append(credIdLength)
        attestedCredData.append(credentialId)
        attestedCredData.append(coseKey)

        // 7. Build authenticator data
        var authenticatorData = Data()
        authenticatorData.append(rpIdHash)
        authenticatorData.append(Data([flags]))
        authenticatorData.append(signCount)
        authenticatorData.append(attestedCredData)

        // 8. Build attestation object (none format)
        let attestationObject = try buildAttestationObjectNone(authenticatorData: authenticatorData)

        // 9. Generate PRF secret if requested
        var prfSecret: Data?
        if enablePrf {
            var prfBytes = Data(count: 32)
            let result = prfBytes.withUnsafeMutableBytes { bytes in
                SecRandomCopyBytes(kSecRandomDefault, 32, bytes.baseAddress!)
            }
            if result == errSecSuccess {
                prfSecret = prfBytes
            }
        }

        // 10. Export keys for storage
        let publicKeyData = try exportPublicKeyAsJWK(publicKey: publicKey)
        let privateKeyData = try exportPrivateKeyAsJWK(privateKey: privateKey)

        return PasskeyCreationResult(
            credentialId: credentialId,
            attestationObject: attestationObject,
            publicKey: publicKeyData,
            privateKey: privateKeyData,
            rpId: rpId,
            userId: userId,
            userName: userName,
            userDisplayName: userDisplayName,
            prfSecret: prfSecret
        )
    }

    /**
     * Create an assertion (authentication)
     * Returns assertion data ready for iOS to return to the RP
     *
     * - Note: This method intentionally has more than 5 parameters to match WebAuthn spec requirements.
     *         SwiftLint: function_parameter_count is disabled for this method as parameters directly map
     *         to WebAuthn assertion parameters and cannot be reasonably grouped.
     */
    // swiftlint:disable:next function_parameter_count
    public static func getAssertion(
        credentialId: Data,
        clientDataHash: Data,
        rpId: String,
        privateKeyJWK: Data,
        userId: Data?,
        uvPerformed: Bool = false,
        prfInputs: PrfInputs? = nil,
        prfSecret: Data? = nil
    ) throws -> PasskeyAssertionResult {

        // 1. RP ID hash
        let rpIdHash = Data(SHA256.hash(data: rpId.data(using: .utf8)!))

        // 2. Build flags
        var flags: UInt8 = 0x01  // UP (bit 0)
        if uvPerformed {
            flags |= 0x04  // UV (bit 2)
        }
        flags |= 0x08  // BE (bit 3)
        flags |= 0x10  // BS (bit 4)

        // 3. Sign count
        let signCount = Data([0x00, 0x00, 0x00, 0x00])

        // 4. Build authenticator data
        var authenticatorData = Data()
        authenticatorData.append(rpIdHash)
        authenticatorData.append(Data([flags]))
        authenticatorData.append(signCount)

        // 5. Build data to sign: authenticatorData || clientDataHash
        var dataToSign = Data()
        dataToSign.append(authenticatorData)
        dataToSign.append(clientDataHash)

        // 6. Import private key and sign
        let privateKey = try importPrivateKeyFromJWK(jwkData: privateKeyJWK)
        let signature = try privateKey.signature(for: dataToSign)

        // 7. Convert raw signature to DER format
        let derSignature = try convertRawSignatureToDER(signature: signature)

        // 8. Evaluate PRF if requested
        var prfResults: PrfResults?
        if let inputs = prfInputs, let secret = prfSecret {
            let firstResult = try evaluatePrf(secret: secret, salt: inputs.first)
            var secondResult: Data?
            if let secondSalt = inputs.second {
                secondResult = try evaluatePrf(secret: secret, salt: secondSalt)
            }
            prfResults = PrfResults(first: firstResult, second: secondResult)
        }

        return PasskeyAssertionResult(
            credentialId: credentialId,
            authenticatorData: authenticatorData,
            signature: derSignature,
            userHandle: userId,
            prfResults: prfResults
        )
    }

    // MARK: - Key Management

    /**
     * Export public key as JWK format (JSON)
     */
    private static func exportPublicKeyAsJWK(publicKey: P256.Signing.PublicKey) throws -> Data {
        let rawRepresentation = publicKey.rawRepresentation

        // CryptoKit's rawRepresentation is 64 bytes (x || y) without the 0x04 prefix
        guard rawRepresentation.count == 64 else {
            print("PasskeyAuthenticator: exportPublicKeyAsJWK - Expected 64 bytes but got \(rawRepresentation.count)")
            throw PasskeyError.invalidPublicKey
        }
        
        // Get bytes and normalize: accept 64 (x||y) or 65 (0x04||x||y)
        var bytes = [UInt8](publicKey.rawRepresentation)
        if bytes.count == 65, bytes[0] == 0x04 { bytes.removeFirst() }
        guard bytes.count == 64 else { throw PasskeyError.invalidPublicKey }
        
        // Safe slicing without Data.subdata
        let xBytes = Data(bytes[0..<32])
        let yBytes = Data(bytes[32..<64])

        let jwk: [String: Any] = [
            "kty": "EC",
            "crv": "P-256",
            "x": xBytes.base64URLEncodedString(),
            "y": yBytes.base64URLEncodedString()
        ]

        return try JSONSerialization.data(withJSONObject: jwk)
    }

    /**
     * Export private key as JWK format (JSON)
     */
    private static func exportPrivateKeyAsJWK(privateKey: P256.Signing.PrivateKey) throws -> Data {
        let rawRepresentation = privateKey.rawRepresentation
        let publicKey = privateKey.publicKey
        
        // Get bytes and normalize: accept 64 (x||y) or 65 (0x04||x||y)
        var bytes = [UInt8](publicKey.rawRepresentation)
        if bytes.count == 65, bytes[0] == 0x04 { bytes.removeFirst() }
        guard bytes.count == 64 else { throw PasskeyError.invalidPublicKey }
        
        // Safe slicing without Data.subdata
        let xBytes = Data(bytes[0..<32])
        let yBytes = Data(bytes[32..<64])

        let dBytes = rawRepresentation

        let jwk: [String: Any] = [
            "kty": "EC",
            "crv": "P-256",
            "x": xBytes.base64URLEncodedString(),
            "y": yBytes.base64URLEncodedString(),
            "d": dBytes.base64URLEncodedString()
        ]

        return try JSONSerialization.data(withJSONObject: jwk)
    }

    /**
     * Import private key from JWK format
     */
    private static func importPrivateKeyFromJWK(jwkData: Data) throws -> P256.Signing.PrivateKey {
        guard let jwk = try JSONSerialization.jsonObject(with: jwkData) as? [String: Any],
              let dBase64url = jwk["d"] as? String else {
            throw PasskeyError.invalidJWK
        }

        let dBytes = try Data(base64URLEncoded: dBase64url)
        return try P256.Signing.PrivateKey(rawRepresentation: dBytes)
    }

    // MARK: - CBOR Encoding

    /**
     * Build COSE EC2 public key for ES256
     * CBOR map: {1: 2, 3: -7, -1: 1, -2: x, -3: y}
     */
    private static func buildCoseEc2Es256(publicKey: P256.Signing.PublicKey) throws -> Data {
        let rawRepresentation = publicKey.rawRepresentation

        print("PasskeyAuthenticator: rawRepresentation count = \(rawRepresentation.count)")
        print("PasskeyAuthenticator: rawRepresentation hex = \(rawRepresentation.map { String(format: "%02x", $0) }.joined())")

        // CryptoKit's rawRepresentation is 64 bytes (x || y) without the 0x04 prefix
        // Unlike X9.63 format which is 65 bytes (0x04 || x || y)
        guard rawRepresentation.count == 64 else {
            print("PasskeyAuthenticator: ERROR - Expected 64 bytes but got \(rawRepresentation.count)")
            throw PasskeyError.invalidPublicKey
        }

        // Get bytes and normalize: accept 64 (x||y) or 65 (0x04||x||y)
        var bytes = [UInt8](publicKey.rawRepresentation)
        if bytes.count == 65, bytes[0] == 0x04 { bytes.removeFirst() }
        guard bytes.count == 64 else { throw PasskeyError.invalidPublicKey }
        
        // Safe slicing without Data.subdata
        let xBytes = bytes[0..<32]
        let yBytes = bytes[32..<64]

        // Build CBOR map manually
        var cbor = Data()
        cbor.append(0xA5)  // map(5)

        // 1: 2 (kty: EC2)
        cbor.append(0x01)  // key 1
        cbor.append(0x02)  // value 2

        // 3: -7 (alg: ES256)
        cbor.append(0x03)  // key 3
        cbor.append(0x26)  // value -7

        // -1: 1 (crv: P-256)
        cbor.append(0x20)  // key -1
        cbor.append(0x01)  // value 1

        // -2: x (x coordinate)
        cbor.append(0x21)  // key -2
        cbor.append(0x58)  // bytes(32)
        cbor.append(0x20)  // length 32
        cbor.append(contentsOf: xBytes)

        // -3: y (y coordinate)
        cbor.append(0x22)  // key -3
        cbor.append(0x58)  // bytes(32)
        cbor.append(0x20)  // length 32
        cbor.append(contentsOf: yBytes)

        return cbor
    }

    /**
     * Build attestation object with "none" format
     * CBOR map: {fmt: "none", attStmt: {}, authData: <bytes>}
     */
    private static func buildAttestationObjectNone(authenticatorData: Data) throws -> Data {
        var cbor = Data()
        cbor.append(0xA3)  // map(3)

        // "fmt": "none"
        cbor.append(contentsOf: cborText("fmt"))
        cbor.append(contentsOf: cborText("none"))

        // "attStmt": {}
        cbor.append(contentsOf: cborText("attStmt"))
        cbor.append(0xA0)  // map(0)

        // "authData": <bytes>
        cbor.append(contentsOf: cborText("authData"))
        cbor.append(contentsOf: cborBytes(authenticatorData))

        return cbor
    }

    /**
     * Encode a string as CBOR text
     */
    private static func cborText(_ text: String) -> Data {
        guard let bytes = text.data(using: .utf8) else {
            return Data()
        }

        var cbor = Data()
        if bytes.count <= 23 {
            cbor.append(0x60 | UInt8(bytes.count))  // text(n)
            cbor.append(bytes)
        } else if bytes.count <= 0xFF {
            cbor.append(0x78)  // text(uint8)
            cbor.append(UInt8(bytes.count))
            cbor.append(bytes)
        } else {
            cbor.append(0x79)  // text(uint16)
            cbor.append(UInt8((bytes.count >> 8) & 0xFF))
            cbor.append(UInt8(bytes.count & 0xFF))
            cbor.append(bytes)
        }

        return cbor
    }

    /**
     * Encode bytes as CBOR byte string
     */
    private static func cborBytes(_ bytes: Data) -> Data {
        var cbor = Data()
        if bytes.count <= 23 {
            cbor.append(0x40 | UInt8(bytes.count))  // bytes(n)
            cbor.append(bytes)
        } else if bytes.count <= 0xFF {
            cbor.append(0x58)  // bytes(uint8)
            cbor.append(UInt8(bytes.count))
            cbor.append(bytes)
        } else {
            cbor.append(0x59)  // bytes(uint16)
            cbor.append(UInt8((bytes.count >> 8) & 0xFF))
            cbor.append(UInt8(bytes.count & 0xFF))
            cbor.append(bytes)
        }

        return cbor
    }

    // MARK: - Signature Conversion

    /**
     * Convert P256.Signing.ECDSASignature to DER format
     * WebAuthn requires DER encoding, but CryptoKit gives us raw r||s
     */
    private static func convertRawSignatureToDER(signature: P256.Signing.ECDSASignature) throws -> Data {
        let rawSig = signature.rawRepresentation

        guard rawSig.count == 64 else {
            throw PasskeyError.invalidSignature
        }

        // Convert SubSequence to Data to avoid indexing issues
        let rVal = Data(rawSig[0..<32])
        let sVal = Data(rawSig[32..<64])

        let rDER = derInteger(rVal)
        let sDER = derInteger(sVal)

        var derSig = Data()
        derSig.append(0x30)  // SEQUENCE
        derSig.append(UInt8(rDER.count + sDER.count))
        derSig.append(rDER)
        derSig.append(sDER)

        return derSig
    }

    /**
     * Encode a positive big integer as DER INTEGER
     */
    private static func derInteger(_ bytes: Data) -> Data {
        // Trim leading zeros, but keep at least 1 byte
        var startIndex = 0
        while startIndex < bytes.count - 1 && bytes[startIndex] == 0x00 {
            startIndex += 1
        }
        var trimmed = bytes.suffix(from: startIndex)

        // If MSB is set, prepend 0x00 to keep it positive
        var value = trimmed
        if !trimmed.isEmpty && (trimmed[trimmed.startIndex] & 0x80) != 0 {
            value = Data([0x00]) + trimmed
        }

        var der = Data()
        der.append(0x02)  // INTEGER
        der.append(UInt8(value.count))
        der.append(value)

        return der
    }

    // MARK: - PRF Extension

    /**
     * Evaluate PRF (hmac-secret extension)
     * Implements: HMAC-SHA256(prfSecret, SHA-256("WebAuthn PRF\x00" || salt))
     */
    private static func evaluatePrf(secret: Data, salt: Data) throws -> Data {
        // Step 1: Domain separation - hash salt with "WebAuthn PRF\x00" prefix
        let prefix = "WebAuthn PRF\0".data(using: .utf8)!
        var domainSeparatedSalt = Data()
        domainSeparatedSalt.append(prefix)
        domainSeparatedSalt.append(salt)

        let hashedSalt = Data(SHA256.hash(data: domainSeparatedSalt))

        // Step 2: Compute HMAC-SHA256(prfSecret, hashedSalt)
        let key = SymmetricKey(data: secret)
        let hmac = HMAC<SHA256>.authenticationCode(for: hashedSalt, using: key)

        return Data(hmac)
    }
}

// MARK: - Supporting Types

public struct PasskeyCreationResult {
    public let credentialId: Data
    public let attestationObject: Data
    public let publicKey: Data  // JWK format
    public let privateKey: Data  // JWK format
    public let rpId: String
    public let userId: Data?
    public let userName: String?
    public let userDisplayName: String?
    public let prfSecret: Data?
}

public struct PasskeyAssertionResult {
    public let credentialId: Data
    public let authenticatorData: Data
    public let signature: Data
    public let userHandle: Data?
    public let prfResults: PrfResults?
}

public struct PrfInputs {
    public let first: Data
    public let second: Data?

    public init(first: Data, second: Data? = nil) {
        self.first = first
        self.second = second
    }
}

public struct PrfResults {
    public let first: Data
    public let second: Data?
}

public enum PasskeyError: Error {
    case invalidPublicKey
    case invalidPrivateKey
    case invalidJWK
    case invalidSignature
    case cborEncodingFailed
}

// MARK: - Data Extension for Base64URL

extension Data {
    func base64URLEncodedString() -> String {
        let base64 = self.base64EncodedString()
        return base64
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    init(base64URLEncoded string: String) throws {
        var base64 = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")

        // Add padding if needed
        let remainder = base64.count % 4
        if remainder > 0 {
            base64.append(String(repeating: "=", count: 4 - remainder))
        }

        guard let data = Data(base64Encoded: base64) else {
            throw PasskeyError.invalidJWK
        }

        self = data
    }
}
