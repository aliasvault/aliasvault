import Foundation
import Security

/// Extension for the VaultStore class to handle RSA public key encryption
extension VaultStore {
    /// Encrypts the vault's encryption key using an RSA public key for mobile login
    /// This method gets the internal encryption key and encrypts it with the provided public key
    /// - Parameter publicKeyJWK: The RSA public key in JWK format (JSON string)
    /// - Returns: The encrypted encryption key
    public func encryptDecryptionKeyForMobileLogin(publicKeyJWK: String) throws -> Data {
        // Get the current encryption key from the vault store
        // This will only work if the vault is unlocked (encryption key is in memory)
        let encryptionKey = try getEncryptionKey()

        // Encrypt the encryption key with the provided public key
        return try encryptWithPublicKey(data: encryptionKey, publicKeyJWK: publicKeyJWK)
    }

    /// Encrypts data using an RSA public key
    /// - Parameters:
    ///   - data: The data to encrypt
    ///   - publicKeyBase64: The RSA public key in JWK format (JSON string, base64 encoded after conversion)
    /// - Returns: The encrypted data
    internal func encryptWithPublicKey(data: Data, publicKeyJWK: String) throws -> Data {
        // Parse the JWK JSON
        guard let jwkData = publicKeyJWK.data(using: .utf8),
              let jwk = try? JSONSerialization.jsonObject(with: jwkData) as? [String: Any],
              let modulusB64 = jwk["n"] as? String,
              let exponentB64 = jwk["e"] as? String else {
            throw NSError(domain: "VaultStore", code: 100, userInfo: [NSLocalizedDescriptionKey: "Invalid JWK format"])
        }

        // Decode modulus and exponent from base64url
        guard let modulusData = base64UrlDecode(modulusB64),
              let exponentData = base64UrlDecode(exponentB64) else {
            throw NSError(domain: "VaultStore", code: 101, userInfo: [NSLocalizedDescriptionKey: "Failed to decode JWK components"])
        }

        // Create RSA public key
        let publicKey = try createPublicKey(modulus: modulusData, exponent: exponentData)

        // Encrypt the data using RSA-OAEP with SHA-256
        var error: Unmanaged<CFError>?
        guard let encryptedData = SecKeyCreateEncryptedData(
            publicKey,
            .rsaEncryptionOAEPSHA256,
            data as CFData,
            &error
        ) as Data? else {
            let errorDescription = error?.takeRetainedValue().localizedDescription ?? "Unknown error"
            throw NSError(domain: "VaultStore", code: 102, userInfo: [NSLocalizedDescriptionKey: "RSA encryption failed: \(errorDescription)"])
        }

        return encryptedData
    }

    /// Creates an RSA public key from modulus and exponent
    private func createPublicKey(modulus: Data, exponent: Data) throws -> SecKey {
        // Create the key attributes
        let keyDict: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrKeyClass as String: kSecAttrKeyClassPublic,
            kSecAttrKeySizeInBits as String: modulus.count * 8
        ]

        // Create the public key data in ASN.1 format
        let publicKeyData = createPublicKeyASN1(modulus: modulus, exponent: exponent)

        var error: Unmanaged<CFError>?
        guard let publicKey = SecKeyCreateWithData(
            publicKeyData as CFData,
            keyDict as CFDictionary,
            &error
        ) else {
            let errorDescription = error?.takeRetainedValue().localizedDescription ?? "Unknown error"
            throw NSError(domain: "VaultStore", code: 103, userInfo: [NSLocalizedDescriptionKey: "Failed to create public key: \(errorDescription)"])
        }

        return publicKey
    }

    /// Creates ASN.1 DER encoded public key data from modulus and exponent
    private func createPublicKeyASN1(modulus: Data, exponent: Data) -> Data {
        // RSA Public Key ASN.1 structure:
        // SEQUENCE {
        //   SEQUENCE {
        //     OBJECT IDENTIFIER rsaEncryption
        //     NULL
        //   }
        //   BIT STRING {
        //     SEQUENCE {
        //       INTEGER modulus
        //       INTEGER exponent
        //     }
        //   }
        // }

        var result = Data()

        // Inner sequence: modulus and exponent
        let modulusEncoded = encodeASN1Integer(modulus)
        let exponentEncoded = encodeASN1Integer(exponent)
        let innerSequence = encodeASN1Sequence(modulusEncoded + exponentEncoded)

        // Bit string containing the inner sequence
        let bitString = encodeASN1BitString(innerSequence)

        // Algorithm identifier sequence
        let algorithmOID = Data([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]) // rsaEncryption OID
        let algorithmNull = Data([0x05, 0x00])
        let algorithmSequence = encodeASN1Sequence(algorithmOID + algorithmNull)

        // Outer sequence
        result = encodeASN1Sequence(algorithmSequence + bitString)

        return result
    }

    /// Encodes data as ASN.1 SEQUENCE
    private func encodeASN1Sequence(_ data: Data) -> Data {
        return encodeASN1(tag: 0x30, data: data)
    }

    /// Encodes data as ASN.1 INTEGER
    private func encodeASN1Integer(_ data: Data) -> Data {
        var integerData = data

        // Remove leading zeros
        while integerData.count > 1 && integerData[0] == 0 {
            integerData = integerData.dropFirst()
        }

        // Add padding byte if the high bit is set (to keep it positive)
        if let firstByte = integerData.first, firstByte >= 0x80 {
            integerData.insert(0x00, at: 0)
        }

        return encodeASN1(tag: 0x02, data: integerData)
    }

    /// Encodes data as ASN.1 BIT STRING
    private func encodeASN1BitString(_ data: Data) -> Data {
        var bitStringData = Data([0x00]) // No unused bits
        bitStringData.append(data)
        return encodeASN1(tag: 0x03, data: bitStringData)
    }

    /// Encodes data with ASN.1 tag and length
    private func encodeASN1(tag: UInt8, data: Data) -> Data {
        var result = Data([tag])
        result.append(encodeASN1Length(data.count))
        result.append(data)
        return result
    }

    /// Encodes length in ASN.1 format
    private func encodeASN1Length(_ length: Int) -> Data {
        if length < 128 {
            return Data([UInt8(length)])
        }

        var lengthBytes = Data()
        var len = length
        while len > 0 {
            lengthBytes.insert(UInt8(len & 0xFF), at: 0)
            len >>= 8
        }

        var result = Data([UInt8(0x80 | lengthBytes.count)])
        result.append(lengthBytes)
        return result
    }

    /// Decodes base64url string to Data
    private func base64UrlDecode(_ base64url: String) -> Data? {
        var base64 = base64url
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")

        // Add padding if needed
        let remainder = base64.count % 4
        if remainder > 0 {
            base64 += String(repeating: "=", count: 4 - remainder)
        }

        return Data(base64Encoded: base64)
    }
}
