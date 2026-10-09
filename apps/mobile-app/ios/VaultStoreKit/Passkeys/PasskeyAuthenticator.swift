import Foundation
import RustCoreFramework

/**
 * The WebAuthn authenticator of the iOS credential provider extension. Key generation, authenticator data,
 * the attestation object, signatures and PRF all run in the Rust core (core/rust/src/passkey).
 * Other platform implementations: PasskeyAuthenticator.kt (Android), PasskeyAuthenticator.ts (browser extension).
 */
public class PasskeyAuthenticator {
    /// COSE algorithm identifier for ES256 (ECDSA P-256 with SHA-256).
    public static let algES256 = -7

    /// The 16-byte credential id of a passkey GUID.
    public static func guidToBytes(_ guid: String) throws -> Data {
        return try passkeyGuidToBytes(guid: guid)
    }

    /// The lowercase GUID text of a 16-byte credential id.
    public static func bytesToGuid(_ bytes: Data) throws -> String {
        return try passkeyBytesToGuid(bytes: bytes)
    }

    /// The first algorithm in the RP's preference order that the authenticator supports; ES256 when the RP lists none.
    public static func pickSupportedAlgorithm(_ algs: [Int]) throws -> Int {
        return Int(try passkeyPickAlgorithm(requested: algs.map(Int64.init)))
    }

    /// Create a new passkey (registration): the attestation object for the RP and the keys the vault stores.
    // swiftlint:disable:next function_parameter_count
    public static func createPasskey(
        credentialId: Data,
        rpId: String,
        userId: Data?,
        userName: String?,
        userDisplayName: String?,
        uvPerformed: Bool = false,
        enablePrf: Bool = false,
        prfInputs: PrfInputs? = nil,
        algorithm: Int = algES256
    ) throws -> PasskeyCreationResult {
        let created = try passkeyCreate(
            credentialId: credentialId,
            rpId: rpId,
            algorithm: Int64(algorithm),
            uvPerformed: uvPerformed,
            enablePrf: enablePrf,
            prfInputs: prfInputs.map { PasskeyPrfInputs(first: $0.first, second: $0.second) }
        )
        return PasskeyCreationResult(
            credentialId: credentialId,
            attestationObject: created.attestationObject,
            publicKey: Data(created.publicKeyJwk.utf8),
            privateKey: Data(created.privateKeyJwk.utf8),
            rpId: rpId,
            userId: userId,
            userName: userName,
            userDisplayName: userDisplayName,
            prfSecret: created.prfSecret,
            prfResults: created.prfResults.map { PrfResults(first: $0.first, second: $0.second) }
        )
    }

    /// Create an assertion (authentication) signed with the stored private key JWK.
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
        let assertion = try passkeyGetAssertion(
            rpId: rpId,
            clientDataHash: clientDataHash,
            privateKeyJwk: String(decoding: privateKeyJWK, as: UTF8.self),
            uvPerformed: uvPerformed,
            prfInputs: prfInputs.map { PasskeyPrfInputs(first: $0.first, second: $0.second) },
            prfSecret: prfSecret
        )
        return PasskeyAssertionResult(
            credentialId: credentialId,
            authenticatorData: assertion.authenticatorData,
            signature: assertion.signature,
            userHandle: userId,
            prfResults: assertion.prfResults.map { PrfResults(first: $0.first, second: $0.second) }
        )
    }
}

// MARK: - Supporting Types

/// A new passkey: what the RP receives, and the JWK keys and PRF secret the vault stores.
public struct PasskeyCreationResult {
    /// The credential id.
    public let credentialId: Data
    /// The CBOR attestation object for the RP.
    public let attestationObject: Data
    /// The public key as JWK JSON.
    public let publicKey: Data
    /// The private key as JWK JSON.
    public let privateKey: Data
    /// The relying party id.
    public let rpId: String
    /// The RP's user handle.
    public let userId: Data?
    /// The RP's user name.
    public let userName: String?
    /// The RP's user display name.
    public let userDisplayName: String?
    /// The PRF secret, when PRF was enabled.
    public let prfSecret: Data?
    /// The PRF outputs for salts requested at registration.
    public let prfResults: PrfResults?
}

/// A signed assertion for the RP.
public struct PasskeyAssertionResult {
    /// The credential id.
    public let credentialId: Data
    /// The authenticator data that was signed.
    public let authenticatorData: Data
    /// The signature over authenticator data and client data hash.
    public let signature: Data
    /// The RP's user handle.
    public let userHandle: Data?
    /// The PRF outputs for the requested salts.
    public let prfResults: PrfResults?
}

/// The salts of a PRF extension request.
public struct PrfInputs {
    /// The first salt.
    public let first: Data?
    /// The optional second salt.
    public let second: Data?

    /// Create PRF inputs from the request's salts.
    public init(first: Data? = nil, second: Data? = nil) {
        self.first = first
        self.second = second
    }
}

/// The PRF outputs for the requested salts.
public struct PrfResults {
    /// The output for the first salt.
    public let first: Data
    /// The output for the second salt, if one was given.
    public let second: Data?
}
