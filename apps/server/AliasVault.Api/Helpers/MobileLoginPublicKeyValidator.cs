//-----------------------------------------------------------------------
// <copyright file="MobileLoginPublicKeyValidator.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using System.Buffers.Text;
using System.Text.Json;

/// <summary>
/// Validates the client public key supplied when initiating a mobile login request. Clients send the
/// RSA-OAEP public key as a JSON serialized JWK, so anything that is not a well-formed RSA public JWK
/// of an accepted key size is rejected before it is persisted.
/// </summary>
public static class MobileLoginPublicKeyValidator
{
    /// <summary>
    /// Maximum accepted length for the serialized JWK. Current clients generate RSA-2048 keys, which are +/- 500 characters long.
    /// </summary>
    public const int MaxLength = 2048;

    /// <summary>
    /// Smallest accepted modulus in bytes (RSA-2048), which is what all current clients generate.
    /// </summary>
    private const int MinModulusBytes = 256;

    /// <summary>
    /// Largest accepted modulus in bytes (RSA-4096), leaving room for a future key size increase.
    /// </summary>
    private const int MaxModulusBytes = 512;

    /// <summary>
    /// Determines whether the supplied value is a well-formed RSA public JWK that we accept.
    /// </summary>
    /// <param name="publicKey">The raw value as supplied by the client.</param>
    /// <returns>True when the value is acceptable, false otherwise.</returns>
    public static bool IsValid(string? publicKey)
    {
        // Bound the input before parsing it so oversized payloads stay cheap to reject.
        if (string.IsNullOrEmpty(publicKey) || publicKey.Length > MaxLength)
        {
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(publicKey);
            var root = document.RootElement;

            if (root.ValueKind != JsonValueKind.Object)
            {
                return false;
            }

            // The mobile login handshake only uses RSA keys.
            if (!TryGetNonEmptyString(root, "kty", out var keyType) || keyType != "RSA")
            {
                return false;
            }

            // A public JWK must not carry private key material.
            if (root.TryGetProperty("d", out _))
            {
                return false;
            }

            // The public exponent must be present and base64url decodable.
            if (!TryGetNonEmptyString(root, "e", out var exponent) || GetBase64UrlByteLength(exponent) <= 0)
            {
                return false;
            }

            // The modulus determines the key size, which must fall within the accepted range.
            if (!TryGetNonEmptyString(root, "n", out var modulus))
            {
                return false;
            }

            return GetBase64UrlByteLength(modulus) is >= MinModulusBytes and <= MaxModulusBytes;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    /// <summary>
    /// Reads a JWK member that is required to be a non-empty JSON string.
    /// </summary>
    /// <param name="root">The JWK object.</param>
    /// <param name="name">The member name to read.</param>
    /// <param name="value">The member value when present.</param>
    /// <returns>True when the member exists and holds a non-empty string.</returns>
    private static bool TryGetNonEmptyString(JsonElement root, string name, out string value)
    {
        value = string.Empty;

        if (!root.TryGetProperty(name, out var element) || element.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        value = element.GetString() ?? string.Empty;
        return value.Length > 0;
    }

    /// <summary>
    /// Returns the decoded byte length of a base64url encoded JWK member. Values that are not valid
    /// base64url, or that decode to more bytes than the largest key we accept, return -1.
    /// </summary>
    /// <param name="value">The base64url encoded value.</param>
    /// <returns>The decoded length in bytes, or -1 when the value is not acceptable.</returns>
    private static int GetBase64UrlByteLength(string value)
    {
        Span<byte> buffer = stackalloc byte[MaxModulusBytes + 4];

        try
        {
            return Base64Url.TryDecodeFromChars(value, buffer, out var bytesWritten) ? bytesWritten : -1;
        }
        catch (FormatException)
        {
            return -1;
        }
    }
}
