import Foundation
import VaultModels

/// Free-text search matcher for autofill credentials.
///
/// Uses the same word-start matching as the item search of the apps (core/client/src/items/ItemFilters.ts, applySearchFilter),
/// over the login fields an autofill credential carries; that search also matches the other non-secret fields of an item.
public class ItemSearchMatcher {

    /// Filter credentials for free-text search: every search word must match (see `matchesSearchWord`) the service name,
    /// username, email, a URL, the notes or the passkey rpId.
    ///
    /// - Parameters:
    ///   - credentials: List of credentials to filter
    ///   - searchText: Free-text search query
    /// - Returns: Filtered list of credentials matching all search words
    public static func filterCredentials(_ credentials: [AutofillCredential], searchText: String) -> [AutofillCredential] {
        let searchWords = searchText.lowercased()
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }

        if searchWords.isEmpty {
            return credentials
        }

        return credentials.filter { credential in
            var searchableFields = [credential.serviceName, credential.username, credential.email, credential.notes]
                .compactMap { $0?.lowercased() }
            searchableFields.append(contentsOf: credential.serviceUrls.map { $0.lowercased() })
            if let passkey = credential.passkey {
                searchableFields.append(passkey.rpId.lowercased())
            }

            return searchWords.allSatisfy { word in
                searchableFields.contains { matchesSearchWord($0, word) }
            }
        }
    }

    /// Whether a search word matches `text`: at the start of a word, so "bank" matches "My Bank" and "bank.com" but not "Databank".
    /// A `*` matches any characters, so a leading `*` drops the word-start rule ("*bank" matches "Databank").
    public static func matchesSearchWord(_ text: String, _ word: String) -> Bool {
        if !word.contains("*") {
            return wordStartRange(text, word) != nil
        }

        let parts = word.split(separator: "*").map(String.init)
        guard let firstPart = parts.first else {
            return true
        }

        let firstRange = word.hasPrefix("*") ? text.range(of: firstPart) : wordStartRange(text, firstPart)
        guard var end = firstRange?.upperBound else {
            return false
        }
        for part in parts.dropFirst() {
            guard let range = text.range(of: part, range: end..<text.endIndex) else {
                return false
            }
            end = range.upperBound
        }
        return true
    }

    /// Range of the first occurrence of `word` in `text` at the start of a word, or nil.
    /// A word that starts with punctuation (".com", "@gmail") or with a script written without spaces may match anywhere.
    private static func wordStartRange(_ text: String, _ word: String) -> Range<String.Index>? {
        guard let first = word.first else {
            return nil
        }
        let anywhere = !isWordCharacter(first) || isNoSpaceScript(first)

        var searchStart = text.startIndex
        while let found = text.range(of: word, range: searchStart..<text.endIndex) {
            if anywhere || found.lowerBound == text.startIndex || !isWordCharacter(text[text.index(before: found.lowerBound)]) {
                return found
            }
            searchStart = text.index(after: found.lowerBound)
        }
        return nil
    }

    /// Whether a character is part of a word: a letter or digit, including any combining marks on it.
    private static func isWordCharacter(_ character: Character) -> Bool {
        character.isLetter || character.isNumber
    }

    /// Whether a character belongs to a script written without spaces between words (Han, kana, Thai, Lao, Myanmar, Khmer).
    private static func isNoSpaceScript(_ character: Character) -> Bool {
        switch character.unicodeScalars.first?.value ?? 0 {
        case 0x0E00...0x0EFF, 0x1000...0x109F, 0x1780...0x17FF, 0x3040...0x30FF, 0x3400...0x4DBF,
             0x4E00...0x9FFF, 0xF900...0xFAFF, 0xFF66...0xFF9F, 0x20000...0x3FFFF:
            return true
        default:
            return false
        }
    }
}
