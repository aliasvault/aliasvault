import Foundation

/**
 * PasskeyHelper
 * -------------------------
 * Utility class for passkey-related operations, including GUID/base64url conversions.
 *
 * This is a Swift port of the reference TypeScript implementation:
 * - Reference: apps/browser-extension/src/utils/passkey/PasskeyHelper.ts
 * - Android: apps/mobile-app/android/app/src/main/java/net/aliasvault/app/vaultstore/passkey/PasskeyHelper.kt
 *
 * IMPORTANT: Keep all implementations synchronized. Changes to the public interface must be
 * reflected in all ports. Method names, parameters, and behavior should remain consistent.
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

}

public enum PasskeyHelperError: Error {
    case invalidGuidFormat
    case invalidByteLength
}
