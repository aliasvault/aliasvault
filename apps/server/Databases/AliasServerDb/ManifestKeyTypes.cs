//-----------------------------------------------------------------------
// <copyright file="ManifestKeyTypes.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

/// <summary>
/// The manifest key types this build supports, each with everything that varies per type.
/// </summary>
public static class ManifestKeyTypes
{
    /// <summary>
    /// Every key type this build supports.
    /// </summary>
    private static readonly ManifestKeyTypeDefinition[] Definitions =
    [
        new ManifestKeyTypeDefinition
        {
            Type = ManifestKeyType.AccountKey,
            Token = "accountkey",
            CarriesEncryptedVek = false,
        },
        new ManifestKeyTypeDefinition
        {
            Type = ManifestKeyType.GrantKey,
            Token = "grantkey",
            CarriesEncryptedVek = true,
        },
    ];

    private static readonly Dictionary<ManifestKeyType, ManifestKeyTypeDefinition> ByType = Definitions.ToDictionary(x => x.Type);
    private static readonly Dictionary<string, ManifestKeyTypeDefinition> ByToken = Definitions.ToDictionary(x => x.Token, StringComparer.Ordinal);

    /// <summary>
    /// Initializes static members of the <see cref="ManifestKeyTypes"/> class.
    /// </summary>
    static ManifestKeyTypes()
    {
        var undefined = Enum.GetValues<ManifestKeyType>().Where(x => !ByType.ContainsKey(x)).ToList();
        if (undefined.Count > 0)
        {
            throw new InvalidOperationException($"Manifest key type(s) without a definition: {string.Join(", ", undefined)}.");
        }
    }

    /// <summary>
    /// Returns the definition of a key type.
    /// </summary>
    /// <param name="type">The key type to look up.</param>
    /// <returns>The definition.</returns>
    public static ManifestKeyTypeDefinition GetDefinition(ManifestKeyType type)
    {
        if (!ByType.TryGetValue(type, out var definition))
        {
            throw new ArgumentOutOfRangeException(nameof(type), type, "Unknown manifest key type.");
        }

        return definition;
    }

    /// <summary>
    /// Returns the token for a key type.
    /// </summary>
    /// <param name="type">The key type to convert.</param>
    /// <returns>The token.</returns>
    public static string ToToken(ManifestKeyType type) => GetDefinition(type).Token;

    /// <summary>
    /// Whether a key type's wrapped VEK is carried to the client alongside the manifest.
    /// </summary>
    /// <param name="type">The key type to check.</param>
    /// <returns>True when the manifest carries the encrypted VEK.</returns>
    public static bool CarriesEncryptedVek(ManifestKeyType type) => GetDefinition(type).CarriesEncryptedVek;

    /// <summary>
    /// Parses a token.
    /// </summary>
    /// <param name="token">The token to parse.</param>
    /// <param name="type">The parsed key type.</param>
    /// <returns>True when the token names a key type this build supports.</returns>
    public static bool TryParse(string? token, out ManifestKeyType type)
    {
        if (token is null || !ByToken.TryGetValue(token, out var definition))
        {
            type = default;
            return false;
        }

        type = definition.Type;
        return true;
    }

    /// <summary>
    /// Parses a token and returns the key type.
    /// </summary>
    /// <param name="token">The token to parse.</param>
    /// <returns>The parsed key type.</returns>
    public static ManifestKeyType Parse(string? token)
    {
        if (!TryParse(token, out var type))
        {
            throw new ArgumentOutOfRangeException(nameof(token), token, "Unknown manifest key type token.");
        }

        return type;
    }
}
