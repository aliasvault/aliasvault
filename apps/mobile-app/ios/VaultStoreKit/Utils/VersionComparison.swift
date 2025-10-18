import Foundation

/// Utility for comparing semantic version strings
public enum VersionComparison {
    /// Checks if version1 is greater than or equal to version2, following SemVer rules.
    ///
    /// Pre-release versions (e.g., -alpha, -beta, -dev) are considered lower than release versions.
    ///
    /// - Parameters:
    ///   - version1: First version string (e.g., "1.2.3" or "1.2.3-beta")
    ///   - version2: Second version string (e.g., "1.2.0" or "1.2.0-alpha")
    /// - Returns: true if version1 >= version2, false otherwise
    ///
    /// - Example:
    /// ```swift
    /// VersionComparison.isGreaterThanOrEqualTo("1.2.3", "1.2.0") // true
    /// VersionComparison.isGreaterThanOrEqualTo("1.2.0-alpha", "1.2.0") // false
    /// VersionComparison.isGreaterThanOrEqualTo("1.2.0", "1.2.0-alpha") // true
    /// ```
    public static func isGreaterThanOrEqualTo(_ version1: String, _ version2: String) -> Bool {
        // Split versions into core and pre-release parts
        let components1 = version1.split(separator: "-", maxSplits: 1)
        let components2 = version2.split(separator: "-", maxSplits: 1)

        let core1 = String(components1[0])
        let core2 = String(components2[0])

        let preRelease1 = components1.count > 1 ? String(components1[1]) : nil
        let preRelease2 = components2.count > 1 ? String(components2[1]) : nil

        // Parse core version numbers
        let parts1 = core1.split(separator: ".").compactMap { Int($0) }
        let parts2 = core2.split(separator: ".").compactMap { Int($0) }

        // Compare core versions first
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

        // If core versions are equal, check pre-release versions
        // No pre-release (release version) is greater than pre-release version
        if preRelease1 == nil && preRelease2 != nil {
            return true
        }
        if preRelease1 != nil && preRelease2 == nil {
            return false
        }
        if preRelease1 == nil && preRelease2 == nil {
            return true
        }

        // Both have pre-release versions, compare them lexically
        return preRelease1! >= preRelease2!
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
