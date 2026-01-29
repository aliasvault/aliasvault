import Foundation
import RustCoreFramework

/// Wrapper for the Rust item matcher using UniFFI bindings.
/// Used in VaultStoreKit for passkey registration to find mergeable items.
public enum RustItemMatcher {

    /// Matching mode for item filtering.
    public enum MatchingMode: String {
        case `default` = "default"
        case urlExact = "url_exact"
        case urlSubdomain = "url_subdomain"
    }

    /// Filter items based on rpId using the Rust core item matcher.
    /// Used during passkey registration to find existing items that can have a passkey merged into them.
    ///
    /// - Parameters:
    ///   - items: List of items to filter (without passkeys)
    ///   - rpId: The relying party identifier (domain) to match against
    ///   - matchingMode: The matching mode to use (default: urlSubdomain)
    /// - Returns: List of item IDs that match the rpId
    public static func filterItems(
        _ items: [ItemWithCredentialInfoData],
        rpId: String,
        matchingMode: MatchingMode = .urlSubdomain
    ) -> [UUID] {
        // Early return for empty rpId or items
        if rpId.isEmpty || items.isEmpty {
            return []
        }

        do {
            // Convert items to the format expected by Rust
            let rustCredentials = items.map { item -> [String: Any?] in
                return [
                    "Id": item.itemId.uuidString,
                    "ItemName": item.serviceName as Any?,
                    "ItemUrls": item.urls,
                    "Username": item.username as Any?
                ]
            }

            // Prepare input JSON for Rust
            // Use https:// prefix for the rpId to match URL format
            let input: [String: Any] = [
                "credentials": rustCredentials,
                "current_url": "https://\(rpId)",
                "page_title": "",
                "matching_mode": matchingMode.rawValue
            ]

            let inputData = try JSONSerialization.data(withJSONObject: input, options: [])
            guard let inputJson = String(data: inputData, encoding: .utf8) else {
                print("[RustItemMatcher] Failed to create input JSON")
                return []
            }

            // Call Rust via UniFFI
            let outputJson = try filterCredentialsJson(inputJson: inputJson)

            // Parse output
            guard let outputData = outputJson.data(using: .utf8),
                  let output = try JSONSerialization.jsonObject(with: outputData) as? [String: Any],
                  let matchedIds = output["matched_ids"] as? [String] else {
                print("[RustItemMatcher] Failed to parse output JSON")
                return []
            }

            // If no matches found, return empty array
            if matchedIds.isEmpty {
                return []
            }

            // Convert matched IDs back to UUIDs, maintaining order
            return matchedIds.compactMap { UUID(uuidString: $0) }

        } catch {
            print("[RustItemMatcher] Error filtering items: \(error)")
            // Return empty array on error
            return []
        }
    }

    /// Filter items and return the full ItemWithCredentialInfoData objects.
    /// Convenience method that returns filtered items instead of just IDs.
    ///
    /// - Parameters:
    ///   - items: List of items to filter (without passkeys)
    ///   - rpId: The relying party identifier (domain) to match against
    ///   - matchingMode: The matching mode to use (default: urlSubdomain)
    /// - Returns: List of items that match the rpId, in priority order
    public static func filterItemsWithData(
        _ items: [ItemWithCredentialInfoData],
        rpId: String,
        matchingMode: MatchingMode = .urlSubdomain
    ) -> [ItemWithCredentialInfoData] {
        let matchedIds = filterItems(items, rpId: rpId, matchingMode: matchingMode)

        // Map matched IDs back to items, maintaining Rust's priority order
        return matchedIds.compactMap { matchedId in
            items.first { $0.itemId == matchedId }
        }
    }
}
