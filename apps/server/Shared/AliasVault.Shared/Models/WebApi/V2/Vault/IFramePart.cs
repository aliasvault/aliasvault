//-----------------------------------------------------------------------
// <copyright file="IFramePart.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// An entry of a binary frame header whose ciphertext follows the header.
/// </summary>
public interface IFramePart
{
    /// <summary>Gets the length of the ciphertext in the frame.</summary>
    int Size { get; }

    /// <summary>Gets or sets the ciphertext, read from the frame after the header.</summary>
    byte[] Data { get; set; }
}
