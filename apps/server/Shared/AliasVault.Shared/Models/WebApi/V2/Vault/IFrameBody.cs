//-----------------------------------------------------------------------
// <copyright file="IFrameBody.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// A request body that arrives as a binary frame: a 4-byte big-endian header length, this object as JSON, then the
/// ciphertexts of its <see cref="FrameParts"/> back to back.
/// </summary>
public interface IFrameBody
{
    /// <summary>Gets the entries that carry a ciphertext, in the order their bytes follow the header.</summary>
    IEnumerable<IFramePart> FrameParts { get; }
}
