//-----------------------------------------------------------------------
// <copyright file="UnlockMethodParameterValidator.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using System.Text.Json;
using AliasVault.Cryptography;

/// <summary>
/// Validates the credentials and KDF parameters a client stores for a master-password unlock method.
/// </summary>
public static class UnlockMethodParameterValidator
{
    /// <summary>
    /// Maximum accepted length of a password salt.
    /// </summary>
    public const int MaxSaltLength = 100;

    /// <summary>
    /// Maximum accepted length of an SRP verifier.
    /// </summary>
    public const int MaxVerifierLength = 1000;

    /// <summary>
    /// Maximum accepted length of the KDF settings JSON.
    /// </summary>
    public const int MaxEncryptionSettingsLength = 255;

    /// <summary>
    /// Whether a client-supplied SRP salt and verifier are present and within the stored size limits.
    /// </summary>
    /// <param name="salt">The password salt.</param>
    /// <param name="verifier">The SRP verifier.</param>
    /// <returns>True when both values may be stored.</returns>
    public static bool WithinSrpCredentialLimits(string? salt, string? verifier)
    {
        return !string.IsNullOrEmpty(salt) && salt.Length <= MaxSaltLength && !string.IsNullOrEmpty(verifier) && verifier.Length <= MaxVerifierLength;
    }

    /// <summary>
    /// Whether a client-chosen SRP identity is a GUID, which is what every client creates at registration.
    /// </summary>
    /// <param name="srpIdentity">The SRP identity.</param>
    /// <returns>True when the identity may be stored.</returns>
    public static bool IsValidSrpIdentity(string? srpIdentity) => Guid.TryParseExact(srpIdentity, "D", out _);

    /// <summary>
    /// Whether the KDF parameters a client derived its new KEK with are Argon2id at or above the accepted minimum.
    /// </summary>
    /// <param name="encryptionType">The KDF type.</param>
    /// <param name="encryptionSettings">The KDF settings JSON.</param>
    /// <returns>True when the parameters are safe to store and advertise at the next login.</returns>
    public static bool IsValidKekDerivationParams(string encryptionType, string encryptionSettings)
    {
        if (encryptionType != Defaults.EncryptionType || string.IsNullOrEmpty(encryptionSettings) || encryptionSettings.Length > MaxEncryptionSettingsLength)
        {
            return false;
        }

        try
        {
            using var settings = JsonDocument.Parse(encryptionSettings);
            if (!settings.RootElement.TryGetProperty("DegreeOfParallelism", out var parallelism) || !parallelism.TryGetInt32(out var parallelismValue))
            {
                return false;
            }

            if (!settings.RootElement.TryGetProperty("MemorySize", out var memorySize) || !memorySize.TryGetInt32(out var memorySizeValue))
            {
                return false;
            }

            if (!settings.RootElement.TryGetProperty("Iterations", out var iterations) || !iterations.TryGetInt32(out var iterationsValue))
            {
                return false;
            }

            // Check if any parameter is less than the allowed minimum, return false.
            if (parallelismValue < Defaults.MinimumArgon2IdDegreeOfParallelism || memorySizeValue < Defaults.MinimumArgon2IdMemorySize || iterationsValue < Defaults.MinimumArgon2IdIterations)
            {
                return false;
            }

            // Check if any parameter exceeds the allowed maximum, return false.
            if (parallelismValue > 16 || memorySizeValue > 2097152 || iterationsValue > 32)
            {
                return false;
            }

            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}
