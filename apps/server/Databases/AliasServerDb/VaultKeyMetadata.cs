//-----------------------------------------------------------------------
// <copyright file="VaultKeyMetadata.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

using System.Text.Json;
using System.Text.Json.Serialization;

/// <summary>
/// The per-method specific fields of a <see cref="VaultKey"/> stored in a JSON column.
/// </summary>
public sealed class VaultKeyMetadata
{
    /// <summary>
    /// Serializer settings for the column.
    /// </summary>
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>
    /// Gets or sets the salt.
    /// </summary>
    public string? Salt { get; set; }

    /// <summary>
    /// Gets or sets the verifier used for SRP authentication.
    /// </summary>
    public string? SrpVerifier { get; set; }

    /// <summary>
    /// Gets or sets the KDF the client derives the KEK with, e.g. <c>Argon2Id</c>.
    /// </summary>
    public string? EncryptionType { get; set; }

    /// <summary>
    /// Gets or sets the encryption settings belonging to <see cref="EncryptionType"/>.
    /// </summary>
    public string? EncryptionSettings { get; set; }

    /// <summary>
    /// Gets or sets the additional fields that are not defined as explicit properties.
    /// </summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement>? AdditionalFields { get; set; }

    /// <summary>
    /// Parses the JSON column value.
    /// </summary>
    /// <param name="json">The raw column value.</param>
    /// <returns>The parsed metadata.</returns>
    public static VaultKeyMetadata Parse(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return new VaultKeyMetadata();
        }

        return JsonSerializer.Deserialize<VaultKeyMetadata>(json, SerializerOptions) ?? new VaultKeyMetadata();
    }

    /// <summary>
    /// Serializes this metadata for storage in the column.
    /// </summary>
    /// <returns>The JSON document to store.</returns>
    public string ToJson() => JsonSerializer.Serialize(this, SerializerOptions);

    /// <summary>
    /// Helper method to return the SRP credentials and KDF parameters.
    /// </summary>
    /// <returns>Tuple with salt, verifier, encryption type and encryption settings.</returns>
    public (string Salt, string SrpVerifier, string EncryptionType, string EncryptionSettings) RequireSrpCredentials()
    {
        if (Salt is null || SrpVerifier is null || EncryptionType is null || EncryptionSettings is null)
        {
            throw new InvalidOperationException("Vault key metadata is missing SRP credentials.");
        }

        return (Salt, SrpVerifier, EncryptionType, EncryptionSettings);
    }
}
