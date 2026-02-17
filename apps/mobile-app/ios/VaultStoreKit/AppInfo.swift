import Foundation

/// Application configuration constants
/// This file contains version requirements and other app-wide configuration values
public enum AppInfo {
    /// The minimum supported AliasVault server (API) version.
    ///
    /// If the server version is below this minimum, the client will reject the connection
    /// and throw a `AppError.serverVersionNotSupported` error, indicating that the
    /// server should be updated to a newer version.
    ///
    /// This ensures that the mobile app only communicates with servers that support
    /// all required API features and prevents compatibility issues with older server versions.
    ///
    /// **Version Format**: Follows Semantic Versioning (SemVer) with optional pre-release tags
    /// - Examples: "0.12.0", "0.12.0-dev", "1.0.0-beta"
    ///
    /// **When to Update**: This value should be updated when:
    /// - The mobile app requires new API endpoints that don't exist in older servers
    /// - Breaking changes in API request/response formats require newer server versions
    public static let minServerVersion = "0.12.0-dev"
}
