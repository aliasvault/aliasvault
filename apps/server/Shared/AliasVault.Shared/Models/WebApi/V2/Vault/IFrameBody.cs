//-----------------------------------------------------------------------
// <copyright file="IFrameBody.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// A body sent as a binary frame: this object is the JSON header, the ciphertexts of its parts follow it.
/// </summary>
public interface IFrameBody
{
    /// <summary>Gets the entries whose ciphertext follows the header, in frame order.</summary>
    IEnumerable<IFramePart> FrameParts { get; }
}
