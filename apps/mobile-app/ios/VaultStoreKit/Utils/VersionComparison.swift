import Foundation

/// Utility for comparing semantic version strings
public enum VersionComparison {
    /// Checks if version1 is greater than or equal to version2, ignoring pre-release suffixes.
    ///
    /// Pre-release suffixes (e.g., -alpha, -beta, -dev) are stripped from version1 before comparison.
    /// This allows server versions like "0.25.0-alpha-dev" to be treated as "0.25.0".
    ///
    /// - Parameters:
    ///   - version1: First version string (e.g., "1.2.3" or "1.2.3-beta")
    ///   - version2: Second version string (e.g., "1.2.0" or "1.2.0-alpha")
    /// - Returns: true if version1 >= version2, false otherwise
    ///
    /// - Example:
    /// ```swift
    /// VersionComparison.isGreaterThanOrEqualTo("1.2.3", "1.2.0") // true
    /// VersionComparison.isGreaterThanOrEqualTo("1.2.0-alpha", "1.2.0") // true (ignores -alpha)
    /// VersionComparison.isGreaterThanOrEqualTo("1.2.0-dev", "1.2.1") // false (0.25.0 < 0.25.1)
    /// ```
    public static func isGreaterThanOrEqualTo(_ version1: String, _ version2: String) -> Bool {
        // Strip pre-release suffix from version1 (server version)
        let components1 = version1.split(separator: "-", maxSplits: 1)
        let components2 = version2.split(separator: "-", maxSplits: 1)

        let core1 = String(components1[0])
        let core2 = String(components2[0])

        // Parse core version numbers
        let parts1 = core1.split(separator: ".").compactMap { Int($0) }
        let parts2 = core2.split(separator: ".").compactMap { Int($0) }

        // Compare core versions only
        let maxLength = max(parts1.count, parts2.count)
        for iVal in 0..<maxLength {
            let part1 = iVal < parts1.count ? parts1[iVal] : 0
            let part2 = iVal < parts2.count ? parts2[iVal] : 0

            if part1 > part2 {
                return true
            }
            if part1 < part2 {
                return false
            }
        }

        // Core versions are equal
        return true
    }

    /// Checks if a given server version meets the minimum requirement
    ///
    /// - Parameters:
    ///   - serverVersion: The server version to validate
    ///   - minimumVersion: The minimum required version (defaults to AppInfo.minServerVersion)
    /// - Returns: true if the server version is supported, false otherwise
    public static func isServerVersionSupported(_ serverVersion: String, minimumVersion: String = AppInfo.minServerVersion) -> Bool {
        return isGreaterThanOrEqualTo(serverVersion, minimumVersion)
    }
}
