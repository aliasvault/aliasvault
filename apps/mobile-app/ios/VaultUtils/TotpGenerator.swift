import Foundation
import CommonCrypto

/// Utility class for generating Time-based One-Time Passwords (TOTP) codes.
/// Implements RFC 6238 TOTP algorithm.
public class TotpGenerator {
    /// The HMAC algorithms supported by the generator, mapped to their CommonCrypto identity.
    /// An unrecognized name falls back to SHA1, which is what RFC 6238 assumes.
    private static func hmacAlgorithm(for name: String) -> (algorithm: CCHmacAlgorithm, digestLength: Int) {
        switch name.uppercased() {
        case "SHA256":
            return (CCHmacAlgorithm(kCCHmacAlgSHA256), Int(CC_SHA256_DIGEST_LENGTH))
        case "SHA512":
            return (CCHmacAlgorithm(kCCHmacAlgSHA512), Int(CC_SHA512_DIGEST_LENGTH))
        default:
            return (CCHmacAlgorithm(kCCHmacAlgSHA1), Int(CC_SHA1_DIGEST_LENGTH))
        }
    }

    /// Generate a TOTP code from a secret key.
    /// - Parameters:
    ///   - secret: The Base32-encoded secret key
    ///   - time: The current time (defaults to now)
    ///   - period: The time step in seconds (defaults to 30)
    ///   - digits: Number of digits in the code (defaults to 6)
    ///   - algorithm: The HMAC algorithm name — SHA1, SHA256 or SHA512 (defaults to SHA1)
    /// - Returns: The generated TOTP code as a string, or nil if generation fails
    public static func generateCode(
        secret: String,
        time: Date = Date(),
        period: Int = 30,
        digits: Int = 6,
        algorithm: String = "SHA1"
    ) -> String? {
        // Decode the Base32 secret
        guard let secretData = base32Decode(secret) else {
            return nil
        }

        // A zero or negative period would divide by zero; treat it as the standard step.
        let step = period > 0 ? period : 30

        // Calculate the time counter
        let counter = UInt64(time.timeIntervalSince1970) / UInt64(step)

        // Generate HOTP code
        return generateHOTP(secret: secretData, counter: counter, digits: digits, algorithm: algorithm)
    }

    /// Generate an HMAC-based One-Time Password (HOTP) code.
    /// - Parameters:
    ///   - secret: The secret key as Data
    ///   - counter: The counter value
    ///   - digits: Number of digits in the code
    ///   - algorithm: The HMAC algorithm name — SHA1, SHA256 or SHA512
    /// - Returns: The generated HOTP code as a string
    private static func generateHOTP(secret: Data, counter: UInt64, digits: Int, algorithm: String) -> String {
        // Convert counter to 8-byte big-endian
        var counterBytes = counter.bigEndian
        let counterData = Data(bytes: &counterBytes, count: 8)

        // Calculate the HMAC using the requested algorithm
        let hmacSpec = hmacAlgorithm(for: algorithm)
        var hmac = [UInt8](repeating: 0, count: hmacSpec.digestLength)
        secret.withUnsafeBytes { secretBytes in
            counterData.withUnsafeBytes { counterBytes in
                CCHmac(
                    hmacSpec.algorithm,
                    secretBytes.baseAddress,
                    secret.count,
                    counterBytes.baseAddress,
                    counterData.count,
                    &hmac
                )
            }
        }

        // Dynamic truncation
        let offset = Int(hmac[hmac.count - 1] & 0x0F)
        let truncatedHash = hmac[offset..<offset + 4]

        // Convert to UInt32 and apply mask
        var code: UInt32 = 0
        for byte in truncatedHash {
            code = (code << 8) | UInt32(byte)
        }
        code &= 0x7FFFFFFF

        // Generate the final code with specified number of digits
        let modulo = UInt32(pow(10.0, Double(digits)))
        let otp = code % modulo

        // Format with leading zeros
        return String(format: "%0\(digits)d", otp)
    }

    /// Decode a Base32-encoded string.
    /// - Parameter string: The Base32-encoded string
    /// - Returns: The decoded Data, or nil if decoding fails
    private static func base32Decode(_ string: String) -> Data? {
        // Remove spaces and convert to uppercase
        let cleanedString = string
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "-", with: "")
            .uppercased()

        // Base32 alphabet (RFC 4648)
        let base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

        var bits = ""

        // Convert each character to its 5-bit binary representation
        for char in cleanedString {
            guard let index = base32Alphabet.firstIndex(of: char) else {
                // Invalid character in Base32 string
                return nil
            }
            let value = base32Alphabet.distance(from: base32Alphabet.startIndex, to: index)
            bits += String(value, radix: 2).padLeft(toLength: 5, withPad: "0")
        }

        // Convert binary string to bytes
        var bytes = [UInt8]()
        for iVal in stride(from: 0, to: bits.count, by: 8) {
            let endIndex = min(iVal + 8, bits.count)
            let byteBits = bits[bits.index(bits.startIndex, offsetBy: iVal)..<bits.index(bits.startIndex, offsetBy: endIndex)]
            if byteBits.count == 8 {
                if let byte = UInt8(byteBits, radix: 2) {
                    bytes.append(byte)
                }
            }
        }

        return Data(bytes)
    }

    /// Get the remaining seconds until the next TOTP code.
    /// - Parameters:
    ///   - time: The current time (defaults to now)
    ///   - period: The time step in seconds (defaults to 30)
    /// - Returns: The number of seconds remaining
    public static func getRemainingSeconds(time: Date = Date(), period: Int = 30) -> Int {
        let step = period > 0 ? period : 30
        let elapsed = Int(time.timeIntervalSince1970) % step
        return step - elapsed
    }
}

/// String extension for padding.
private extension String {
    func padLeft(toLength length: Int, withPad pad: String) -> String {
        let padLength = length - self.count
        if padLength <= 0 {
            return self
        }
        return String(repeating: pad, count: padLength) + self
    }
}
