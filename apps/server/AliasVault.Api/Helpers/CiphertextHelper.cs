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
    /// Decodes a base64-encoded ciphertext into the raw ciphertext bytes.
    /// </summary>
    /// <param name="base64">The base64-encoded ciphertext as it arrived on the request.</param>
    /// <param name="bytes">The decoded ciphertext, empty when the ciphertext is malformed.</param>
    /// <returns>True when the ciphertext decodes to something that can be AES-GCM ciphertext; false when the caller should reject the request.</returns>
    public static bool TryDecode(string base64, out byte[] bytes)
    {
        try
        {
            bytes = Convert.FromBase64String(base64);
        }
        catch (FormatException)
        {
            bytes = [];
            return false;
        }

        return bytes.Length >= MinCiphertextLength;
    }
}
