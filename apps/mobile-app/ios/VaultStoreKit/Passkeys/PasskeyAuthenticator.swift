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
 * This is a Swift port of the reference TypeScript implementation:
 * - Reference: apps/browser-extension/src/utils/passkey/PasskeyAuthenticator.ts
 * - Android: apps/mobile-app/android/app/src/main/java/net/aliasvault/app/vaultstore/passkey/PasskeyAuthenticator.kt
 *
 * IMPORTANT: Keep all implementations synchronized. Changes to the public interface must be
 * reflected in all ports. Method names, parameters, and behavior should remain consistent.
 *
 * Key features:
 * - ES256 (ECDSA P-256) and RS256 (RSASSA-PKCS1-v1.5) key pair generation
 * - CBOR/COSE encoding for attestation objects
 * - Proper authenticator data with WebAuthn flags
 * - Self-attestation (packed format) or none attestation
 * - Consistent base64url handling
 * - Sign count always 0 for syncable passkeys
 * - BE/BS flags for backup-eligible and backed-up status
 */
public class PasskeyAuthenticator {

    /// AliasVault AAGUID: a11a5faa-9f32-4b8c-8c5d-2f7d13e8c942
    private static let aaguid: [UInt8] = [
        0xa1, 0x1a, 0x5f, 0xaa, 0x9f, 0x32, 0x4b, 0x8c,
        0x8c, 0x5d, 0x2f, 0x7d, 0x13, 0xe8, 0xc9, 0x42
    ]

    /// COSE algorithm identifier for ES256 (ECDSA P-256 with SHA-256).
    public static let algES256 = -7

    /// COSE algorithm identifier for RS256 (RSASSA-PKCS1-v1.5 with SHA-256).
    public static let algRS256 = -257

    /// Algorithms supported by this authenticator, in our order of preference.
    private static let supportedAlgorithms = [algES256, algRS256]

    /**
     * Pick a supported credential algorithm from the RP's requested algorithms.
     * Honors the RP's preference order and returns the first algorithm we support.
     * Defaults to ES256 when the RP provides no algorithms.
     *
     * - Parameter algs: COSE algorithm identifiers from the RP (e.g. ASCOSEAlgorithmIdentifier rawValues)
     * - Returns: The chosen COSE algorithm identifier (-7 for ES256, -257 for RS256)
     */
    public static func pickSupportedAlgorithm(_ algs: [Int]) throws -> Int {
        if algs.isEmpty {
            return algES256
        }
        for alg in algs where supportedAlgorithms.contains(alg) {
            return alg
        }
        throw PasskeyError.unsupportedAlgorithm
    }

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
        enablePrf: Bool = false,
        prfInputs: PrfInputs? = nil,
        algorithm: Int = algES256
    ) throws -> PasskeyCreationResult {

        // 1. Generate key pair, build COSE key, and export JWKs for the chosen algorithm
        let coseKey: Data
        let publicKeyData: Data
        let privateKeyData: Data
        if algorithm == algRS256 {
            let rsaKey = try generateRsaKey()
            coseKey = try buildCoseRsaRs256(privateKey: rsaKey)
            publicKeyData = try exportRsaPublicKeyAsJWK(privateKey: rsaKey)
            privateKeyData = try exportRsaPrivateKeyAsJWK(privateKey: rsaKey)
        } else {
            let privateKey = P256.Signing.PrivateKey()
            let publicKey = privateKey.publicKey
            coseKey = try buildCoseEc2Es256(publicKey: publicKey)
            publicKeyData = try exportPublicKeyAsJWK(publicKey: publicKey)
            privateKeyData = try exportPrivateKeyAsJWK(privateKey: privateKey)
        }

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

        // 5. Build attested credential data
        let credIdLength = Data([
            UInt8((credentialId.count >> 8) & 0xFF),
            UInt8(credentialId.count & 0xFF)
        ])
        var attestedCredData = Data(aaguid)
        attestedCredData.append(credIdLength)
        attestedCredData.append(credentialId)
        attestedCredData.append(coseKey)

        // 6. Build authenticator data
        var authenticatorData = Data()
        authenticatorData.append(rpIdHash)
        authenticatorData.append(Data([flags]))
        authenticatorData.append(signCount)
        authenticatorData.append(attestedCredData)

        // 7. Build attestation object (none format)
        let attestationObject = try buildAttestationObjectNone(authenticatorData: authenticatorData)

        // 8. Generate PRF secret if requested
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

        // 9. Evaluate PRF values if requested during registration (some authenticators try this during registration already)
        var prfResults: PrfResults?
        if let inputs = prfInputs, let firstSalt = inputs.first, let secret = prfSecret {
            var firstResult = try evaluatePrf(secret: secret, salt: firstSalt)
            var secondResult: Data?
            if let secondSalt = inputs.second {
                secondResult = try evaluatePrf(secret: secret, salt: secondSalt)
            }
            prfResults = PrfResults(first: firstResult, second: secondResult)
        }

        return PasskeyCreationResult(
            credentialId: credentialId,
            attestationObject: attestationObject,
            publicKey: publicKeyData,
            privateKey: privateKeyData,
            rpId: rpId,
            userId: userId,
            userName: userName,
            userDisplayName: userDisplayName,
            prfSecret: prfSecret,
            prfResults: prfResults
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

        // 6. Determine algorithm from the stored key, import it, and sign.
        //    The signature is returned in the form the RP expects:
        //    DER-encoded for ES256, raw PKCS#1 v1.5 for RS256.
        let signatureData: Data
        if jwkKeyType(jwkData: privateKeyJWK) == "RSA" {
            signatureData = try signRsa(jwkData: privateKeyJWK, dataToSign: dataToSign)
        } else {
            let privateKey = try importPrivateKeyFromJWK(jwkData: privateKeyJWK)
            let signature = try privateKey.signature(for: dataToSign)
            signatureData = try convertRawSignatureToDER(signature: signature)
        }

        // 8. Evaluate PRF if requested
        var prfResults: PrfResults?
        if let inputs = prfInputs, let firstSalt = inputs.first, let secret = prfSecret {
            var firstResult = try evaluatePrf(secret: secret, salt: firstSalt)

            var secondResult: Data?
            if let secondSalt = inputs.second {
                secondResult = try evaluatePrf(secret: secret, salt: secondSalt)
            }
            prfResults = PrfResults(first: firstResult, second: secondResult)
        }

        return PasskeyAssertionResult(
            credentialId: credentialId,
            authenticatorData: authenticatorData,
            signature: signatureData,
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

    /**
     * Read the "kty" field of a JWK ("EC" or "RSA"). Defaults to "EC".
     */
    private static func jwkKeyType(jwkData: Data) -> String {
        guard let jwk = try? JSONSerialization.jsonObject(with: jwkData) as? [String: Any],
              let kty = jwk["kty"] as? String else {
            return "EC"
        }
        return kty
    }

    // MARK: - CBOR Encoding

    /**
     * Build COSE EC2 public key for ES256
     * CBOR map: {1: 2, 3: -7, -1: 1, -2: x, -3: y}
     */
    private static func buildCoseEc2Es256(publicKey: P256.Signing.PublicKey) throws -> Data {
        let rawRepresentation = publicKey.rawRepresentation

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
     * Build COSE RSA public key for RS256 (RFC 8230)
     * CBOR map: {1: 3 (kty: RSA), 3: -257 (alg: RS256), -1: n (modulus), -2: e (exponent)}
     */
    private static func buildCoseRsaRs256(privateKey: SecKey) throws -> Data {
        // swiftlint:disable:next identifier_name - n/e are the standard RSA modulus/exponent names (RFC 8230)
        let (n, e) = try rsaModulusAndExponent(privateKey: privateKey)

        var cbor = Data()
        cbor.append(0xA4)  // map(4)

        // 1: 3 (kty: RSA)
        cbor.append(0x01)
        cbor.append(0x03)

        // 3: -257 (alg: RS256), encoded as negative int with 2-byte argument
        cbor.append(0x03)
        cbor.append(contentsOf: [0x39, 0x01, 0x00])

        // -1: n (modulus)
        cbor.append(0x20)
        cbor.append(cborBytes(n))

        // -2: e (exponent)
        cbor.append(0x21)
        cbor.append(cborBytes(e))

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
        der.append(derLength(value.count))
        der.append(value)

        return der
    }

    // MARK: - ASN.1 DER

    /**
     * Encode a DER length (definite form), supporting multi-byte lengths.
     */
    private static func derLength(_ length: Int) -> Data {
        if length < 0x80 {
            return Data([UInt8(length)])
        }
        var lenBytes: [UInt8] = []
        var value = length
        while value > 0 {
            lenBytes.insert(UInt8(value & 0xFF), at: 0)
            value >>= 8
        }
        return Data([UInt8(0x80 | lenBytes.count)] + lenBytes)
    }

    /**
     * Wrap pre-encoded DER elements in a SEQUENCE.
     */
    private static func derSequence(_ elements: [Data]) -> Data {
        var body = Data()
        for element in elements {
            body.append(element)
        }
        var result = Data()
        result.append(0x30)  // SEQUENCE
        result.append(derLength(body.count))
        result.append(body)
        return result
    }

    /**
     * Parse a DER SEQUENCE of INTEGERs, returning each integer's content as
     * an unsigned big-endian minimal byte string (leading sign byte stripped).
     */
    private static func parseDerIntegerSequence(_ der: Data) throws -> [Data] {
        var index = der.startIndex

        func readByte() throws -> UInt8 {
            guard index < der.endIndex else { throw PasskeyError.invalidJWK }
            let byte = der[index]
            index = der.index(after: index)
            return byte
        }

        func readLength() throws -> Int {
            let first = try readByte()
            if first < 0x80 {
                return Int(first)
            }
            let count = Int(first & 0x7F)
            guard count > 0 && count <= 8 else { throw PasskeyError.invalidJWK }
            var length = 0
            for _ in 0..<count {
                length = (length << 8) | Int(try readByte())
            }
            return length
        }

        guard try readByte() == 0x30 else { throw PasskeyError.invalidJWK }  // SEQUENCE
        let seqLength = try readLength()
        guard let seqEnd = der.index(index, offsetBy: seqLength, limitedBy: der.endIndex) else {
            throw PasskeyError.invalidJWK
        }

        var integers: [Data] = []
        while index < seqEnd {
            guard try readByte() == 0x02 else { throw PasskeyError.invalidJWK }  // INTEGER
            let length = try readLength()
            guard let contentEnd = der.index(index, offsetBy: length, limitedBy: seqEnd) else {
                throw PasskeyError.invalidJWK
            }
            var content = Data(der[index..<contentEnd])
            index = contentEnd
            // Strip leading zero bytes to get unsigned minimal representation
            while content.count > 1 && content.first == 0x00 {
                content = content.dropFirst()
            }
            integers.append(Data(content))
        }
        return integers
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

// MARK: - RSA Key Management (RS256)

/*
 * RSA helpers live in an extension to keep the main type body within SwiftLint's
 * type_body_length limit. Same-file `private` access keeps them callable from the class.
 */
extension PasskeyAuthenticator {

    /**
     * Generate an RSA-2048 key pair (returns the private SecKey).
     */
    private static func generateRsaKey() throws -> SecKey {
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrKeySizeInBits as String: 2048
        ]
        var error: Unmanaged<CFError>?
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
            throw PasskeyError.keyGenerationFailed
        }
        return key
    }

    /**
     * Extract (modulus, exponent) from an RSA private key's public component.
     * SecKeyCopyExternalRepresentation of an RSA public key is PKCS#1
     * RSAPublicKey ::= SEQUENCE { modulus INTEGER, publicExponent INTEGER }.
     */
    private static func rsaModulusAndExponent(privateKey: SecKey) throws -> (n: Data, e: Data) {
        guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
            throw PasskeyError.invalidPublicKey
        }
        var error: Unmanaged<CFError>?
        guard let der = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
            throw PasskeyError.invalidPublicKey
        }
        let ints = try parseDerIntegerSequence(der)
        guard ints.count == 2 else { throw PasskeyError.invalidPublicKey }
        return (ints[0], ints[1])
    }

    /**
     * Export RSA public key as JWK: {kty: "RSA", n, e}.
     */
    private static func exportRsaPublicKeyAsJWK(privateKey: SecKey) throws -> Data {
        // swiftlint:disable:next identifier_name - n/e are the standard RSA modulus/exponent names (RFC 8230)
        let (n, e) = try rsaModulusAndExponent(privateKey: privateKey)
        let jwk: [String: Any] = [
            "kty": "RSA",
            "n": n.base64URLEncodedString(),
            "e": e.base64URLEncodedString()
        ]
        return try JSONSerialization.data(withJSONObject: jwk)
    }

    /**
     * Export RSA private key as JWK: {kty: "RSA", n, e, d, p, q, dp, dq, qi}.
     * SecKeyCopyExternalRepresentation of an RSA private key is PKCS#1
     * RSAPrivateKey ::= SEQUENCE { version, modulus, publicExponent, privateExponent,
     *   prime1, prime2, exponent1, exponent2, coefficient } (9 INTEGERs).
     */
    private static func exportRsaPrivateKeyAsJWK(privateKey: SecKey) throws -> Data {
        var error: Unmanaged<CFError>?
        guard let der = SecKeyCopyExternalRepresentation(privateKey, &error) as Data? else {
            throw PasskeyError.invalidPrivateKey
        }
        let ints = try parseDerIntegerSequence(der)
        guard ints.count >= 9 else { throw PasskeyError.invalidPrivateKey }
        let jwk: [String: Any] = [
            "kty": "RSA",
            "n": ints[1].base64URLEncodedString(),
            "e": ints[2].base64URLEncodedString(),
            "d": ints[3].base64URLEncodedString(),
            "p": ints[4].base64URLEncodedString(),
            "q": ints[5].base64URLEncodedString(),
            "dp": ints[6].base64URLEncodedString(),
            "dq": ints[7].base64URLEncodedString(),
            "qi": ints[8].base64URLEncodedString()
        ]
        return try JSONSerialization.data(withJSONObject: jwk)
    }

    /**
     * Import an RSA private key from JWK and sign data with RS256
     * (RSASSA-PKCS1-v1.5 over SHA-256). The ".message" variant hashes the
     * input internally, matching how P256.signature(for:) hashes its input.
     */
    private static func signRsa(jwkData: Data, dataToSign: Data) throws -> Data {
        let key = try importRsaPrivateKeyFromJWK(jwkData: jwkData)
        var error: Unmanaged<CFError>?
        guard let sig = SecKeyCreateSignature(
            key,
            .rsaSignatureMessagePKCS1v15SHA256,
            dataToSign as CFData,
            &error
        ) as Data? else {
            throw PasskeyError.invalidSignature
        }
        return sig
    }

    /**
     * Build a PKCS#1 RSAPrivateKey from a JWK and import it as a SecKey.
     */
    private static func importRsaPrivateKeyFromJWK(jwkData: Data) throws -> SecKey {
        guard let jwk = try JSONSerialization.jsonObject(with: jwkData) as? [String: Any],
              let nB64 = jwk["n"] as? String,
              let eB64 = jwk["e"] as? String,
              let dB64 = jwk["d"] as? String,
              let pB64 = jwk["p"] as? String,
              let qB64 = jwk["q"] as? String,
              let dpB64 = jwk["dp"] as? String,
              let dqB64 = jwk["dq"] as? String,
              let qiB64 = jwk["qi"] as? String else {
            throw PasskeyError.invalidJWK
        }

        // swiftlint:disable identifier_name - n/e/d/p/q/dp/dq/qi are the standard RSA/JWK component names (RFC 7518)
        let n = try Data(base64URLEncoded: nB64)
        let e = try Data(base64URLEncoded: eB64)
        let d = try Data(base64URLEncoded: dB64)
        let p = try Data(base64URLEncoded: pB64)
        let q = try Data(base64URLEncoded: qB64)
        let dp = try Data(base64URLEncoded: dpB64)
        let dq = try Data(base64URLEncoded: dqB64)
        let qi = try Data(base64URLEncoded: qiB64)
        // swiftlint:enable identifier_name

        // PKCS#1 RSAPrivateKey DER (version 0, two-prime)
        let der = derSequence([
            derInteger(Data([0x00])),  // version
            derInteger(n),
            derInteger(e),
            derInteger(d),
            derInteger(p),
            derInteger(q),
            derInteger(dp),
            derInteger(dq),
            derInteger(qi)
        ])

        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
            kSecAttrKeySizeInBits as String: n.count * 8
        ]
        var error: Unmanaged<CFError>?
        guard let key = SecKeyCreateWithData(der as CFData, attributes as CFDictionary, &error) else {
            throw PasskeyError.invalidPrivateKey
        }
        return key
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
    public let prfResults: PrfResults?
}

public struct PasskeyAssertionResult {
    public let credentialId: Data
    public let authenticatorData: Data
    public let signature: Data
    public let userHandle: Data?
    public let prfResults: PrfResults?
}

public struct PrfInputs {
    public let first: Data?
    public let second: Data?

    public init(first: Data? = nil, second: Data? = nil) {
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
    case keyGenerationFailed
    case unsupportedAlgorithm
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
