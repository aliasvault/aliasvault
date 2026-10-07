//-----------------------------------------------------------------------
// <copyright file="IFramePart.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// A header entry of a binary frame whose ciphertext follows the header, addressed by offset and size.
/// </summary>
public interface IFramePart
{
    /// <summary>Gets or sets where the ciphertext starts, counted from the first byte after the header.</summary>
    int Offset { get; set; }

    /// <summary>Gets or sets the length of the ciphertext, 0 when the entry carries none.</summary>
    int Size { get; set; }

    /// <summary>Gets or sets the ciphertext. Sent after the JSON header, not inside it.</summary>
    byte[] Data { get; set; }
}
