package net.aliasvault.app.vaultstore.utils

import net.aliasvault.app.utils.AppInfo

/**
 * Utility for comparing semantic version strings
 *
 * This is a Kotlin port of the iOS Swift implementation:
 * - Reference: apps/mobile-app/ios/VaultStoreKit/Utils/VersionComparison.swift
 *
 * IMPORTANT: Keep all implementations synchronized. Changes to the public interface must be
 * reflected in all ports. Version comparison logic should remain consistent across platforms.
 */
object VersionComparison {
    /**
     * Checks if version1 is greater than or equal to version2, ignoring pre-release suffixes.
     *
     * Pre-release suffixes (e.g., -alpha, -beta, -dev) are stripped from version1 before comparison.
     * This allows server versions like "0.25.0-alpha-dev" to be treated as "0.25.0".
     *
     * @param version1 First version string (e.g., "1.2.3" or "1.2.3-beta")
     * @param version2 Second version string (e.g., "1.2.0" or "1.2.0-alpha")
     * @return true if version1 >= version2, false otherwise
     *
     * Example:
     * ```kotlin
     * VersionComparison.isGreaterThanOrEqualTo("1.2.3", "1.2.0") // true
     * VersionComparison.isGreaterThanOrEqualTo("1.2.0-alpha", "1.2.0") // true (ignores -alpha)
     * VersionComparison.isGreaterThanOrEqualTo("1.2.0-dev", "1.2.1") // false (0.25.0 < 0.25.1)
     * ```
     */
    fun isGreaterThanOrEqualTo(version1: String, version2: String): Boolean {
        // Strip pre-release suffix from version1 (server version)
        val components1 = version1.split("-", limit = 2)
        val components2 = version2.split("-", limit = 2)

        val core1 = components1[0]
        val core2 = components2[0]

        // Parse core version numbers
        val parts1 = core1.split(".").mapNotNull { it.toIntOrNull() }
        val parts2 = core2.split(".").mapNotNull { it.toIntOrNull() }

        // Compare core versions only
        val maxLength = maxOf(parts1.size, parts2.size)
        for (i in 0 until maxLength) {
            val part1 = parts1.getOrElse(i) { 0 }
            val part2 = parts2.getOrElse(i) { 0 }

            when {
                part1 > part2 -> return true
                part1 < part2 -> return false
            }
        }

        // Core versions are equal
        return true
    }

    /**
     * Checks if a given server version meets the minimum requirement.
     *
     * @param serverVersion The server version to validate
     * @param minimumVersion The minimum required version (defaults to AppInfo.MIN_SERVER_VERSION)
     * @return true if the server version is supported, false otherwise
     */
    fun isServerVersionSupported(
        serverVersion: String,
        minimumVersion: String = AppInfo.MIN_SERVER_VERSION,
    ): Boolean {
        return isGreaterThanOrEqualTo(serverVersion, minimumVersion)
    }
}
