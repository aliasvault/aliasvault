//-----------------------------------------------------------------------
// <copyright file="SqlVaultVersion.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.JsInterop.Models;

/// <summary>
/// Represents a vault version.
/// </summary>
public sealed class SqlVaultVersion
{
    /// <summary>
    /// Gets the revision number.
    /// </summary>
    public int Revision { get; init; }

    /// <summary>
    /// Gets the version.
    /// </summary>
    public string Version { get; init; } = string.Empty;

    /// <summary>
    /// Gets the description.
    /// </summary>
    public string Description { get; init; } = string.Empty;

    /// <summary>
    /// Gets the AliasVault release version that this vault version was introduced in.
    /// </summary>
    public string ReleaseVersion { get; init; } = string.Empty;

    /// <summary>
    /// Gets the compatible up to version.
    /// </summary>
    public string CompatibleUpToVersion { get; init; } = string.Empty;
}
