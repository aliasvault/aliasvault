//-----------------------------------------------------------------------
// <copyright file="ManifestKeyTypeDefinition.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

/// <summary>
/// The properties of a single <see cref="ManifestKeyType"/>.
/// </summary>
public sealed class ManifestKeyTypeDefinition
{
    /// <summary>
    /// Gets the key type this definition describes.
    /// </summary>
    public required ManifestKeyType Type { get; init; }

    /// <summary>
    /// Gets the token that names the key type on the wire.
    /// </summary>
    public required string Token { get; init; }

    /// <summary>
    /// Gets a value indicating whether the encrypted VEK travels to the client along with the manifest.
    /// </summary>
    public required bool CarriesEncryptedVek { get; init; }
}
