//-----------------------------------------------------------------------
// <copyright file="VersionHelper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

/// <summary>
/// VersionHelper class which contains helper methods for version comparison.
/// </summary>
public static class VersionHelper
{
    /// <summary>
    /// Checks if version1 is older than version2.
    /// </summary>
    /// <param name="version1">The first version.</param>
    /// <param name="version2">The second version.</param>
    /// <returns>True if version1 is older than version2, false otherwise.</returns>
    public static bool IsVersionOlder(string version1, string version2)
    {
        if (string.IsNullOrEmpty(version1) || string.IsNullOrEmpty(version2))
        {
            return false;
        }

        // Try parsing both versions
        if (!Version.TryParse(version1, out Version? v1) || !Version.TryParse(version2, out Version? v2))
        {
            // If one of the versions is not a valid version string, throw an exception.
            throw new ArgumentException("Invalid version string.");
        }

        // Compare the versions
        return v1 < v2;
    }

    /// <summary>
    /// Checks if version1 is equal or newer than version2.
    /// </summary>
    /// <param name="version1">The first version.</param>
    /// <param name="version2">The second version.</param>
    /// <returns>True if version1 is older than version2, false otherwise.</returns>
    public static bool IsVersionEqualOrNewer(string version1, string version2)
    {
        if (string.IsNullOrEmpty(version1) || string.IsNullOrEmpty(version2))
        {
            return false;
        }

        // Try parsing both versions
        if (!Version.TryParse(version1, out Version? v1) || !Version.TryParse(version2, out Version? v2))
        {
            // If one of the versions is not a valid version string, throw an exception.
            throw new ArgumentException("Invalid version string.");
        }

        // Compare the versions
        return v1 >= v2;
    }

    /// <summary>
    /// Checks if a version is blocked for a specific platform.
    /// Checks both platform-specific blocks and global blocks (using "*" key).
    /// </summary>
    /// <param name="platform">The platform to check (e.g., "chrome", "ios").</param>
    /// <param name="version">The version to check.</param>
    /// <param name="blockedVersions">Dictionary of platform to blocked versions. Use "*" for global blocks.</param>
    /// <returns>True if the version is blocked for this platform, false otherwise.</returns>
    public static bool IsVersionBlocked(string platform, string version, IReadOnlyDictionary<string, HashSet<string>> blockedVersions)
    {
        if (string.IsNullOrEmpty(version) || blockedVersions == null || blockedVersions.Count == 0)
        {
            return false;
        }

        // Check global blocks (applies to all platforms)
        if (blockedVersions.TryGetValue("*", out var globalBlocked) && globalBlocked.Contains(version))
        {
            return true;
        }

        // Check platform-specific blocks
        if (!string.IsNullOrEmpty(platform) &&
            blockedVersions.TryGetValue(platform, out var platformBlocked) &&
            platformBlocked.Contains(version))
        {
            return true;
        }

        return false;
    }
}
