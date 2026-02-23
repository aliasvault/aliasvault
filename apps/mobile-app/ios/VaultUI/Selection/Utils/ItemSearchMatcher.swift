import Foundation
import VaultModels

/// Free-text search matcher for items/credentials.
/// Uses substring matching across all searchable fields.
///
/// Matches behavior of:
/// - React Native: apps/mobile-app/app/(tabs)/items/index.tsx (lines 269-281)
/// - Browser Extension: apps/browser-extension/src/entrypoints/background/VaultMessageHandler.ts (filterItemsBySearchTerm)
/// - Blazor Web: apps/server/AliasVault.Client/Main/Components/Widgets/SearchWidget.razor (lines 224-234)
public class ItemSearchMatcher {

    /// Filter credentials/items for free-text search using substring matching.
    ///
    /// Search logic:
    /// - Splits search text into individual words
    /// - Every word must appear in at least one searchable field (AND logic)
    /// - Case-insensitive substring matching
    /// - Searches: service name, username, email, URLs, notes
    /// - Supports partial URL matching (e.g., "mysubdomain.ex" matches "mysubdomain.example.com")
    ///
    /// - Parameters:
    ///   - credentials: List of credentials to filter
    ///   - searchText: Free-text search query
    /// - Returns: Filtered list of credentials matching all search words
    public static func filterCredentials(_ credentials: [AutofillCredential], searchText: String) -> [AutofillCredential] {
        // Early return for empty search
        if searchText.isEmpty {
            return credentials
        }

        // Normalize and split search text into words
        let searchLower = searchText.lowercased().trimmingCharacters(in: .whitespaces)
        let searchWords = searchLower.split(separator: " ").map { String($0) }.filter { !$0.isEmpty }

        if searchWords.isEmpty {
            return credentials
        }

        // Filter credentials: every search word must match at least one field
        return credentials.filter { credential in
            // Build searchable fields array
            var searchableFields: [String] = []

            // Add service name
            if let serviceName = credential.serviceName {
                searchableFields.append(serviceName.lowercased())
            }

            // Add username
            if let username = credential.username, !username.isEmpty {
                searchableFields.append(username.lowercased())
            }

            // Add email
            if let email = credential.email, !email.isEmpty {
                searchableFields.append(email.lowercased())
            }

            // Add all URLs (enables partial URL matching)
            for url in credential.serviceUrls {
                searchableFields.append(url.lowercased())
            }

            // Add notes
            if let notes = credential.notes, !notes.isEmpty {
                searchableFields.append(notes.lowercased())
            }

            // Check if every search word appears in at least one field
            return searchWords.allSatisfy { word in
                searchableFields.contains { field in
                    field.contains(word)
                }
            }
        }
    }
}
