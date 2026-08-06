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
    /// Every algorithm this build supports.
    /// </summary>
    private static readonly VaultKeyAlgorithmDefinition[] Definitions =
    [
        new VaultKeyAlgorithmDefinition
        {
            Algorithm = VaultKeyAlgorithm.Aes256Gcm,
            Token = "aes256-gcm",
            IsAsymmetric = false,
        },
        new VaultKeyAlgorithmDefinition
        {
            Algorithm = VaultKeyAlgorithm.RsaOaepSha256,
            Token = "rsa-oaep-sha256",
            IsAsymmetric = true,
        },
    ];

    private static readonly Dictionary<VaultKeyAlgorithm, VaultKeyAlgorithmDefinition> ByAlgorithm = Definitions.ToDictionary(x => x.Algorithm);
    private static readonly Dictionary<string, VaultKeyAlgorithmDefinition> ByToken = Definitions.ToDictionary(x => x.Token, StringComparer.Ordinal);

    /// <summary>
    /// Initializes static members of the <see cref="VaultKeyAlgorithms"/> class.
    /// </summary>
    static VaultKeyAlgorithms()
    {
        var undefined = Enum.GetValues<VaultKeyAlgorithm>().Where(x => !ByAlgorithm.ContainsKey(x)).ToList();
        if (undefined.Count > 0)
        {
            throw new InvalidOperationException($"Vault key algorithm(s) without a definition: {string.Join(", ", undefined)}.");
        }
    }

    /// <summary>
    /// Returns the definition of an algorithm.
    /// </summary>
    /// <param name="algorithm">The algorithm to look up.</param>
    /// <returns>The definition.</returns>
    public static VaultKeyAlgorithmDefinition GetDefinition(VaultKeyAlgorithm algorithm)
    {
        if (!ByAlgorithm.TryGetValue(algorithm, out var definition))
        {
            throw new ArgumentOutOfRangeException(nameof(algorithm), algorithm, "Unknown vault key algorithm.");
        }

        return definition;
    }

    /// <summary>
    /// Returns the token for an algorithm.
    /// </summary>
    /// <param name="algorithm">The algorithm to convert.</param>
    /// <returns>The token.</returns>
    public static string ToToken(VaultKeyAlgorithm algorithm) => GetDefinition(algorithm).Token;

    /// <summary>
    /// Parses a token.
    /// </summary>
    /// <param name="token">The token to parse.</param>
    /// <param name="algorithm">The parsed algorithm.</param>
    /// <returns>True when the token names an algorithm this build supports.</returns>
    public static bool TryParse(string? token, out VaultKeyAlgorithm algorithm)
    {
        if (token is null || !ByToken.TryGetValue(token, out var definition))
        {
            algorithm = default;
            return false;
        }

        algorithm = definition.Algorithm;
        return true;
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
    /// Whether an algorithm encrypts to a public key, i.e. is valid on a <see cref="ManifestKeyType.GrantKey"/> grant.
    /// </summary>
    /// <param name="algorithm">The algorithm to check.</param>
    /// <returns>True for asymmetric algorithms.</returns>
    public static bool IsAsymmetric(VaultKeyAlgorithm algorithm) => GetDefinition(algorithm).IsAsymmetric;
}
