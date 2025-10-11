import Foundation

/**
 * PasskeyHelper
 * -------------------------
 * Utility class for passkey-related operations, including GUID/base64url conversions.
 * Port of the browser extension PasskeyHelper.ts to Swift.
 * TODO: review implementation and docs.
 */
public class PasskeyHelper {

    /**
     * Convert GUID string to byte array
     * Example: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" → Data(16 bytes)
     */
    public static func guidToBytes(_ guid: String) throws -> Data {
        // Remove dashes
        let hex = guid.replacingOccurrences(of: "-", with: "")

        guard hex.count == 32 else {
            throw PasskeyHelperError.invalidGuidFormat
        }

        var bytes = Data()
        var index = hex.startIndex

        for _ in 0..<16 {
            let nextIndex = hex.index(index, offsetBy: 2)
            let byteString = String(hex[index..<nextIndex])

            guard let byte = UInt8(byteString, radix: 16) else {
                throw PasskeyHelperError.invalidGuidFormat
            }

            bytes.append(byte)
            index = nextIndex
        }

        return bytes
    }

    /**
     * Convert byte array to GUID string (uppercase)
     * Example: Data(16 bytes) → "3F2504E0-4F89-11D3-9A0C-0305E82C3301"
     */
    public static func bytesToGuid(_ bytes: Data) throws -> String {
        guard bytes.count == 16 else {
            throw PasskeyHelperError.invalidByteLength
        }

        let hex = bytes.map { String(format: "%02x", $0) }.joined()

        // Insert dashes in canonical format: 8-4-4-4-12
        let parts = [
            String(hex.prefix(8)),
            String(hex.dropFirst(8).prefix(4)),
            String(hex.dropFirst(12).prefix(4)),
            String(hex.dropFirst(16).prefix(4)),
            String(hex.dropFirst(20))
        ]

        return parts.joined(separator: "-").uppercased()
    }

    /**
     * Convert GUID to base64url for WebAuthn credential ID
     * Example: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" → "PyUE4E-JEdOaDAPF6CwzAQ"
     */
    public static func guidToBase64url(_ guid: String) throws -> String {
        let bytes = try guidToBytes(guid)
        return bytes.base64URLEncodedString()
    }

    /**
     * Convert base64url to GUID for database lookup
     * Example: "PyUE4E-JEdOaDAPF6CwzAQ" → "3F2504E0-4F89-11D3-9A0C-0305E82C3301"
     */
    public static func base64urlToGuid(_ base64url: String) throws -> String {
        let bytes = try Data(base64URLEncoded: base64url)
        return try bytesToGuid(bytes)
    }

    /**
     * Convert byte array to base64url string
     */
    public static func bytesToBase64url(_ bytes: Data) -> String {
        return bytes.base64URLEncodedString()
    }

    /**
     * Convert base64url string to byte array
     */
    public static func base64urlToBytes(_ base64url: String) throws -> Data {
        return try Data(base64URLEncoded: base64url)
    }

    /**
     * Generate a random GUID string
     */
    public static func generateGuid() -> String {
        return UUID().uuidString.uppercased()
    }

    /**
     * Generate random bytes for credential ID
     */
    public static func generateCredentialId(length: Int = 16) throws -> Data {
        var bytes = Data(count: length)
        let result = bytes.withUnsafeMutableBytes { bytesPtr in
            SecRandomCopyBytes(kSecRandomDefault, length, bytesPtr.baseAddress!)
        }

        guard result == errSecSuccess else {
            throw PasskeyHelperError.randomGenerationFailed
        }

        return bytes
    }
}

public enum PasskeyHelperError: Error {
    case invalidGuidFormat
    case invalidByteLength
    case randomGenerationFailed
}
