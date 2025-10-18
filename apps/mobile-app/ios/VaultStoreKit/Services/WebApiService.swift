import Foundation

/**
 * Native Swift WebAPI service for making HTTP requests to the AliasVault server.
 * This service handles authentication, token refresh, and all HTTP operations.
 */
public class WebApiService {
    private let vaultStore = VaultStore()

    // Token storage keys
    private let apiUrlKey = "apiUrl"
    private let accessTokenKey = "accessToken"
    private let refreshTokenKey = "refreshToken"

    // Default API URL
    private let defaultApiUrl = "https://app.aliasvault.net/api"

    /// Shared UserDefaults for communication between main app and extension
    private let userDefaults = UserDefaults(suiteName: VaultConstants.userDefaultsSuite)!

    // MARK: - Configuration Management

    /// Initialize the WebApiService
    public init() {}

    /**
     * Set the API URL
     */
    public func setApiUrl(_ url: String) throws {
        userDefaults.set(url, forKey: apiUrlKey)
        userDefaults.synchronize()
    }

    /**
     * Get the API URL
     */
    public func getApiUrl() -> String {
        return userDefaults.string(forKey: apiUrlKey) ?? defaultApiUrl
    }

    /**
     * Get the base URL with /v1/ appended
     */
    private func getBaseUrl() -> String {
        let apiUrl = getApiUrl()
        let trimmedUrl = apiUrl.hasSuffix("/") ? String(apiUrl.dropLast()) : apiUrl
        return "\(trimmedUrl)/v1/"
    }

    // MARK: - Token Management

    /**
     * Set both access and refresh tokens
     */
    public func setAuthTokens(accessToken: String, refreshToken: String) throws {
        userDefaults.set(accessToken, forKey: accessTokenKey)
        userDefaults.set(refreshToken, forKey: refreshTokenKey)
        userDefaults.synchronize()
    }

    /**
     * Get the access token
     */
    public func getAccessToken() -> String? {
        return userDefaults.string(forKey: accessTokenKey)
    }

    /**
     * Get the refresh token
     */
    public func getRefreshToken() -> String? {
        return userDefaults.string(forKey: refreshTokenKey)
    }

    /**
     * Clear both access and refresh tokens
     */
    public func clearAuthTokens() {
        userDefaults.removeObject(forKey: accessTokenKey)
        userDefaults.removeObject(forKey: refreshTokenKey)
        userDefaults.synchronize()
    }

    // MARK: - HTTP Request Execution

    /**
     * Execute a WebAPI request with support for authentication and token refresh
     */
    public func executeRequest(
        method: String,
        endpoint: String,
        body: String?,
        headers: [String: String],
        requiresAuth: Bool
    ) async throws -> WebApiResponse {
        var requestHeaders = headers

        // Add authorization header if authentication is required AND not already provided
        if requiresAuth {
            if requestHeaders["Authorization"] == nil, let accessToken = getAccessToken() {
                requestHeaders["Authorization"] = "Bearer \(accessToken)"
                print("WebApiService: Added Authorization header from stored token")
            } else if requestHeaders["Authorization"] != nil {
                print("WebApiService: Using provided Authorization header instead of stored token")
            }
        }

        // Add client version header
        requestHeaders["X-AliasVault-Client"] = getClientVersionHeader()

        // Execute the request
        let response = try await executeRawRequest(
            method: method,
            endpoint: endpoint,
            body: body,
            headers: requestHeaders
        )

        // Handle 401 Unauthorized - attempt token refresh
        if response.statusCode == 401 && requiresAuth {

            if let newToken = try await refreshAccessToken() {
                // Retry the request with the new token
                var retryHeaders = headers
                retryHeaders["Authorization"] = "Bearer \(newToken)"
                retryHeaders["X-AliasVault-Client"] = getClientVersionHeader()

                let retryResponse = try await executeRawRequest(
                    method: method,
                    endpoint: endpoint,
                    body: body,
                    headers: retryHeaders
                )

                return retryResponse
            } else {
                print("WebApiService: Token refresh failed, returning 401")
                // Token refresh failed, return 401 response
                return response
            }
        }

        return response
    }

    /**
     * Execute a raw HTTP request without token refresh logic
     */
    private func executeRawRequest(
        method: String,
        endpoint: String,
        body: String?,
        headers: [String: String]
    ) async throws -> WebApiResponse {
        let baseUrl = getBaseUrl()
        let urlString = "\(baseUrl)\(endpoint)"

        guard let url = URL(string: urlString) else {
            throw NSError(
                domain: "WebApiService",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Invalid URL: \(urlString)"]
            )
        }

        var request = URLRequest(url: url)
        request.httpMethod = method.uppercased()

        // Set headers
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }

        // Set body if present
        if let bodyString = body {
            request.httpBody = bodyString.data(using: .utf8)
        }

        // Execute the request
        let (data, urlResponse) = try await URLSession.shared.data(for: request)

        guard let httpResponse = urlResponse as? HTTPURLResponse else {
            throw NSError(
                domain: "WebApiService",
                code: -2,
                userInfo: [NSLocalizedDescriptionKey: "Invalid response type"]
            )
        }

        // Parse response body
        let responseBody = String(data: data, encoding: .utf8) ?? ""

        // Extract headers
        var responseHeaders: [String: String] = [:]
        for (key, value) in httpResponse.allHeaderFields {
            if let keyString = key as? String, let valueString = value as? String {
                responseHeaders[keyString] = valueString
            }
        }

        return WebApiResponse(
            statusCode: httpResponse.statusCode,
            body: responseBody,
            headers: responseHeaders
        )
    }

    /**
     * Refresh the access token using the refresh token
     */
    private func refreshAccessToken() async throws -> String? {
        guard let refreshToken = getRefreshToken() else {
            return nil
        }

        guard let accessToken = getAccessToken() else {
            return nil
        }

        // Prepare refresh request body
        let refreshBody: [String: String] = [
            "token": accessToken,
            "refreshToken": refreshToken
        ]

        guard let jsonData = try? JSONSerialization.data(withJSONObject: refreshBody),
              let jsonString = String(data: jsonData, encoding: .utf8) else {
            return nil
        }

        var headers = [
            "Content-Type": "application/json",
            "X-Ignore-Failure": "true"
        ]
        headers["X-AliasVault-Client"] = getClientVersionHeader()

        do {
            let response = try await executeRawRequest(
                method: "POST",
                endpoint: "Auth/refresh",
                body: jsonString,
                headers: headers
            )

            guard response.statusCode == 200 else {
                return nil
            }

            // Parse the response JSON
            guard let data = response.body.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let newToken = json["token"] as? String,
                  let newRefreshToken = json["refreshToken"] as? String else {
                return nil
            }

            // Update stored tokens
            try setAuthTokens(accessToken: newToken, refreshToken: newRefreshToken)

            return newToken
        } catch {
            print("WebApiService: Token refresh failed: \(error)")
            return nil
        }
    }

    // MARK: - Helper Methods

    /**
     * Get the client version header value
     */
    private func getClientVersionHeader() -> String {
        // Get version from Info.plist
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
        let baseVersion = version.split(separator: "-").first ?? ""
        return "ios-\(baseVersion)"
    }

    // MARK: - Favicon Extraction

    /**
     * Extract favicon from a URL
     * Returns the favicon image data as base64-decoded bytes, or nil if extraction failed
     */
    public func extractFavicon(url: String) async throws -> Data? {
        // URL encode the service URL parameter
        guard let encodedUrl = url.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else {
            print("WebApiService: Failed to encode URL for favicon extraction")
            return nil
        }

        do {
            // Make request with 5 second timeout
            let response = try await executeRequest(
                method: "GET",
                endpoint: "Favicon/Extract?url=\(encodedUrl)",
                body: nil,
                headers: [:],
                requiresAuth: true
            )

            guard response.statusCode == 200 else {
                print("WebApiService: Favicon extraction failed with status \(response.statusCode)")
                return nil
            }

            // Parse JSON response
            guard let responseData = response.body.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: responseData) as? [String: Any],
                  let imageBase64 = json["image"] as? String else {
                print("WebApiService: Failed to parse favicon response")
                return nil
            }

            // Decode base64 image
            guard let imageData = Data(base64Encoded: imageBase64) else {
                print("WebApiService: Failed to decode base64 favicon image")
                return nil
            }

            return imageData

        } catch {
            print("WebApiService: Favicon extraction error: \(error)")
            return nil
        }
    }

    // MARK: - Token Revocation

    /**
     * Revoke tokens via WebAPI (called when logging out)
     */
    public func revokeTokens() async throws {
        do {
            // Get tokens to revoke
            guard let refreshToken = getRefreshToken(),
                  let accessToken = getAccessToken() else {
                // No tokens to revoke
                clearAuthTokens()
                return
            }

            // Prepare revoke request body
            let revokeBody: [String: String] = [
                "token": accessToken,
                "refreshToken": refreshToken
            ]

            guard let jsonData = try? JSONSerialization.data(withJSONObject: revokeBody),
                  let jsonString = String(data: jsonData, encoding: .utf8) else {
                clearAuthTokens()
                return
            }

            // Execute revoke request
            let response = try await executeRequest(
                method: "POST",
                endpoint: "Auth/revoke",
                body: jsonString,
                headers: ["Content-Type": "application/json"],
                requiresAuth: false
            )

            // Log if revoke failed, but always clear tokens
            if response.statusCode != 200 {
                print("WebApiService: Token revoke failed with status \(response.statusCode)")
            }
        } catch {
            print("WebApiService: Token revoke error: \(error)")
        }

        // Always clear tokens, even if revoke fails
        clearAuthTokens()
    }
}
