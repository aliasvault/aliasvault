import Foundation
import VaultModels
import RustCoreFramework

/// Wrapper for the Rust item matcher using UniFFI bindings.
public class RustItemMatcher {

    /// Filter credentials based on search text using the Rust core item matcher.
    ///
    /// - Parameters:
    ///   - credentials: List of credentials to filter
    ///   - searchText: Search term (app package name, URL, or text)
    /// - Returns: Filtered list of credentials
    public static func filterCredentials(_ credentials: [AutofillCredential], searchText: String) -> [AutofillCredential] {
        // Early return for empty search
        if searchText.isEmpty {
            return credentials
        }

        do {
            // Convert AutofillCredential to the format expected by Rust
            let rustCredentials = credentials.map { credential -> [String: Any?] in
                return [
                    "id": credential.id.uuidString.lowercased(),
                    "itemName": credential.serviceName,
                    "itemUrls": credential.serviceUrls,
                    "username": credential.username
                ]
            }

            // Prepare input JSON for Rust
            let input: [String: Any] = [
                "credentials": rustCredentials,
                "currentUrl": searchText,
                "pageTitle": "",
                "matchingMode": "default"
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
                  let matchedIds = output["matchedIds"] as? [String] else {
                print("[RustItemMatcher] Failed to parse output JSON")
                return []
            }

            // If no matches found, return empty array
            if matchedIds.isEmpty {
                return []
            }

            // Convert matched IDs back to UUIDs
            let matchedUUIDs = matchedIds.compactMap { UUID(uuidString: $0) }

            // Filter and sort credentials by matched order
            let filtered = matchedUUIDs.compactMap { matchedId in
                credentials.first { $0.id == matchedId }
            }

            return filtered

        } catch {
            print("[RustItemMatcher] Error filtering credentials: \(error)")
            return []
        }
    }
}
