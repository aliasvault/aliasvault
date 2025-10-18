import Foundation

/// This class contains common  string extension methods.
extension String {
    /// Trims standard and invisible characters only from the beginning and end of the string.
    func smartTrim() -> String {
        let invisiblePattern = #"^[\u{FEFF}\u{200B}\u{00A0}\u{202A}-\u{202E}\u{2060}\u{180E}]+|[\u{FEFF}\u{200B}\u{00A0}\u{202A}-\u{202E}\u{2060}\u{180E}]+$"#
        
        guard let regex = try? NSRegularExpression(pattern: invisiblePattern, options: []) else {
            // Fallback to trimming only whitespace if regex creation fails
            return self.trimmingCharacters(in: .whitespacesAndNewlines)
        }

        let range = NSRange(location: 0, length: self.utf16.count)
        let cleaned = regex.stringByReplacingMatches(in: self, options: [], range: range, withTemplate: "")
        return cleaned.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
