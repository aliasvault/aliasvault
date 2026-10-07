//-----------------------------------------------------------------------
// <copyright file="CiphertextHelper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

/// <summary>
/// Helpers for the encrypted payloads.
/// </summary>
public static class CiphertextHelper
{
    /// <summary>
    /// Smallest byte length a payload can have and still be AES-GCM ciphertext (IV + auth tag overhead).
    /// </summary>
    private const int MinCiphertextLength = 16;

    /// <summary>
    /// Checks that the bytes are long enough to be AES-GCM ciphertext.
    /// </summary>
    /// <param name="bytes">The ciphertext as it arrived on the request.</param>
    /// <returns>True when the bytes can be AES-GCM ciphertext; false when the caller should reject the request.</returns>
    public static bool IsCiphertext(byte[] bytes)
    {
        return bytes.Length >= MinCiphertextLength;
    }

    /// <summary>
    /// Checks that the ciphertext is the one the client hashed, so a payload damaged on the way in is never stored.
    /// </summary>
    /// <param name="bytes">The decoded ciphertext.</param>
    /// <param name="expectedHash">The SHA-256 of the ciphertext as hex, as the client computed it.</param>
    /// <returns>True when the hashes match.</returns>
    public static bool MatchesHash(byte[] bytes, string? expectedHash)
    {
        return string.Equals(Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)), expectedHash, StringComparison.OrdinalIgnoreCase);
    }
}
