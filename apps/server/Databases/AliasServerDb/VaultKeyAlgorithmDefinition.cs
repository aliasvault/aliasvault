//-----------------------------------------------------------------------
// <copyright file="VaultKeyAlgorithmDefinition.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

/// <summary>
/// The properties of a single <see cref="VaultKeyAlgorithm"/>.
/// </summary>
public sealed class VaultKeyAlgorithmDefinition
{
    /// <summary>
    /// Gets the algorithm this definition describes.
    /// </summary>
    public required VaultKeyAlgorithm Algorithm { get; init; }

    /// <summary>
    /// Gets the token that names the algorithm on the wire and in the database.
    /// </summary>
    public required string Token { get; init; }

    /// <summary>
    /// Gets a value indicating whether the algorithm encrypts to a public key.
    /// </summary>
    public required bool IsAsymmetric { get; init; }
}
