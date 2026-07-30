//-----------------------------------------------------------------------
// <copyright file="VaultKeyAlgorithms.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

/// <summary>
/// Vault key encryption algorithms.
/// </summary>
public static class VaultKeyAlgorithms
{
    /// <summary>
    /// The token for <see cref="VaultKeyAlgorithm.Aes256Gcm"/>.
    /// </summary>
    public const string Aes256GcmToken = "aes256-gcm";

    /// <summary>
    /// The token for <see cref="VaultKeyAlgorithm.RsaOaepSha256"/>.
    /// </summary>
    public const string RsaOaepSha256Token = "rsa-oaep-sha256";

    /// <summary>
    /// Returns the token for an algorithm.
    /// </summary>
    /// <param name="algorithm">The algorithm to convert.</param>
    /// <returns>The token.</returns>
    public static string ToToken(VaultKeyAlgorithm algorithm) => algorithm switch
    {
        VaultKeyAlgorithm.Aes256Gcm => Aes256GcmToken,
        VaultKeyAlgorithm.RsaOaepSha256 => RsaOaepSha256Token,
        _ => throw new ArgumentOutOfRangeException(nameof(algorithm), algorithm, "Unknown vault key algorithm."),
    };

    /// <summary>
    /// Parses a token.
    /// </summary>
    /// <param name="token">The token to parse.</param>
    /// <param name="algorithm">The parsed algorithm.</param>
    /// <returns>True when the token names an algorithm this build supports.</returns>
    public static bool TryParse(string? token, out VaultKeyAlgorithm algorithm)
    {
        switch (token)
        {
            case Aes256GcmToken:
                algorithm = VaultKeyAlgorithm.Aes256Gcm;
                return true;
            case RsaOaepSha256Token:
                algorithm = VaultKeyAlgorithm.RsaOaepSha256;
                return true;
            default:
                algorithm = default;
                return false;
        }
    }

    /// <summary>
    /// Parses a token and returns the algorithm.
    /// </summary>
    /// <param name="token">The token to parse.</param>
    /// <returns>The parsed algorithm.</returns>
    public static VaultKeyAlgorithm Parse(string? token)
    {
        if (!TryParse(token, out var algorithm))
        {
            throw new ArgumentOutOfRangeException(nameof(token), token, "Unknown vault key algorithm token.");
        }

        return algorithm;
    }

    /// <summary>
    /// Whether an algorithm encrypts to a public key, i.e. is valid on a <see cref="VaultKeyType.PublicKey"/> grant. A
    /// symmetric algorithm there would mean the sharer and the recipient share a secret, which they never do.
    /// </summary>
    /// <param name="algorithm">The algorithm to check.</param>
    /// <returns>True for asymmetric algorithms.</returns>
    public static bool IsAsymmetric(VaultKeyAlgorithm algorithm) => algorithm == VaultKeyAlgorithm.RsaOaepSha256;
}
