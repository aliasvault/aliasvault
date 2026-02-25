//-----------------------------------------------------------------------
// <copyright file="AppInfo.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Core;

/// <summary>
/// Provides application-wide constant information and versioning.
/// </summary>
public static class AppInfo
{
    /// <summary>
    /// Gets the application name.
    /// </summary>
    public const string ApplicationName = "AliasVault";

    /// <summary>
    /// Gets the major version number.
    /// </summary>
    public const int VersionMajor = 0;

    /// <summary>
    /// Gets the minor version number.
    /// </summary>
    public const int VersionMinor = 27;

    /// <summary>
    /// Gets the patch version number.
    /// </summary>
    public const int VersionPatch = 0;

    /// <summary>
    /// Gets the version stage (e.g., "", "-alpha", "-beta", "-rc").
    /// </summary>
    public const string VersionStage = "";

    /// <summary>
    /// Gets the minimum supported AliasVault client version. Normally the minimum client version is the same
    /// for all clients as we are using a monorepo to build all clients from the same source code. But it's
    /// possible to override the minimum client version for a specific client if needed.
    /// </summary>
    public const string MinimumClientVersion = "0.12.0";

    /// <summary>
    /// Gets a dictionary of minimum supported client versions that the WebApi supports.
    /// If client version is lower than the minimum supported version, the client will show a message
    /// to the user to update itself to the minimum supported version.
    /// </summary>
    public static IReadOnlyDictionary<string, string> MinimumClientVersions { get; } = new Dictionary<string, string>
    {
        // Main WASM client.
        { "web", MinimumClientVersion },

        // Browser extensions.
        { "chrome", MinimumClientVersion },
        { "firefox", MinimumClientVersion },
        { "edge", MinimumClientVersion },
        { "safari", MinimumClientVersion },

        // Fallback for unknown browsers.
        { "browser", MinimumClientVersion },

        // Mobile apps.
        { "ios", MinimumClientVersion },
        { "android", MinimumClientVersion },
    }.AsReadOnly();

    /// <summary>
    /// Gets a dictionary of specific client versions that are explicitly unsupported (blocked) per platform.
    /// This is useful for blocking specific versions with (critical) bugs while still allowing
    /// older versions that predate the bug to continue working.
    /// For example: if 0.26.0 has a critical bug fixed in 0.26.1, we can block only 0.26.0
    /// without affecting users on 0.25.x who may still have compatible vaults.
    /// Use "*" as the platform key to block a version across all platforms.
    /// </summary>
    public static IReadOnlyDictionary<string, HashSet<string>> UnsupportedClientVersions { get; } = new Dictionary<string, HashSet<string>>
    {
        // Block version across all platforms: "*" applies to all clients.
        { "*", ["0.26.0"] }, // Version with vault migration bug, fixed in 0.26.1

        // Platform-specific blocks (examples):
        // { "chrome", ["0.25.0"] },
        // { "ios", ["0.24.0", "0.24.1"] },
    };

    /// <summary>
    /// Gets the build number, typically used in CI/CD pipelines.
    /// Can be overridden at build time.
    /// </summary>
    public static string BuildNumber { get; } = string.Empty;

    /// <summary>
    /// Gets a value indicating whether the application is running in development mode.
    /// </summary>
    public static bool IsDevelopment { get; } =
#if DEBUG
        true;
#else
        false;
#endif

    /// <summary>
    /// Gets the full version string in semantic versioning format.
    /// </summary>
    /// <returns>The full version string.</returns>
    public static string GetFullVersion()
    {
        var version = $"{VersionMajor}.{VersionMinor}.{VersionPatch}{VersionStage}";

        if (IsDevelopment)
        {
            version += string.IsNullOrEmpty(BuildNumber)
                ? "-dev"
                : $"-dev.{BuildNumber}";
        }
        else if (!string.IsNullOrEmpty(BuildNumber))
        {
            version += $"+{BuildNumber}";
        }

        return version;
    }

    /// <summary>
    /// Gets a short version string (major.minor).
    /// </summary>
    /// <returns>The short version string.</returns>
    public static string GetShortVersion() => $"{VersionMajor}.{VersionMinor}";
}
