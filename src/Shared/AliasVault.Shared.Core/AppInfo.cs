//-----------------------------------------------------------------------
// <copyright file="AppInfo.cs" company="lanedirt">
// Copyright (c) lanedirt. All rights reserved.
// Licensed under the MIT license. See LICENSE.md file in the project root for full license information.
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
    public const int VersionMinor = 12;

    /// <summary>
    /// Gets the patch version number.
    /// </summary>
    public const int VersionPatch = 2;

    /// <summary>
    /// Gets a dictionary of minimum supported client versions that the WebApi supports.
    /// If client version is lower than the minimum supported version, the client will show a message
    /// to the user to update itself to the minimum supported version.
    /// </summary>
    public static IReadOnlyDictionary<string, string> MinimumClientVersions { get; } = new Dictionary<string, string>
    {
        { "chrome", "0.12.0" },
        { "web", "0.12.0" },
    }.AsReadOnly();

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
        var version = $"{VersionMajor}.{VersionMinor}.{VersionPatch}";

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
