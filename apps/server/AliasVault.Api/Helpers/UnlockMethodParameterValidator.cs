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
        if (encryptionType != Defaults.EncryptionType || !TryParseSettings(encryptionSettings, out var parallelism, out var memorySize, out var iterations))
        {
            return false;
        }

        // Check if any parameter is less than the allowed minimum, return false.
        if (parallelism < Defaults.MinimumArgon2IdDegreeOfParallelism || memorySize < Defaults.MinimumArgon2IdMemorySize || iterations < Defaults.MinimumArgon2IdIterations)
        {
            return false;
        }

        // Check if any parameter exceeds the allowed maximum, return false.
        return parallelism <= 16 && memorySize <= 2097152 && iterations <= 32;
    }

    /// <summary>
    /// Whether stored KDF settings ask for less memory or fewer iterations than the current defaults.
    /// </summary>
    /// <param name="encryptionSettings">The KDF settings JSON of the stored unlock method.</param>
    /// <returns>True when the settings are readable and below the defaults.</returns>
    public static bool IsBelowDefaults(string encryptionSettings)
    {
        return TryParseSettings(encryptionSettings, out _, out var memorySize, out var iterations) && (memorySize < Defaults.Argon2IdMemorySize || iterations < Defaults.Argon2IdIterations);
    }

    /// <summary>
    /// Read the Argon2id cost values from a KDF settings JSON.
    /// </summary>
    /// <param name="encryptionSettings">The KDF settings JSON.</param>
    /// <param name="parallelism">The degree of parallelism.</param>
    /// <param name="memorySize">The memory size in KiB.</param>
    /// <param name="iterations">The number of iterations.</param>
    /// <returns>True when all three values are present as integers.</returns>
    private static bool TryParseSettings(string? encryptionSettings, out int parallelism, out int memorySize, out int iterations)
    {
        parallelism = memorySize = iterations = 0;
        if (string.IsNullOrEmpty(encryptionSettings) || encryptionSettings.Length > MaxEncryptionSettingsLength)
        {
            return false;
        }

        try
        {
            using var settings = JsonDocument.Parse(encryptionSettings);
            var root = settings.RootElement;
            return root.ValueKind == JsonValueKind.Object
                && root.TryGetProperty("DegreeOfParallelism", out var parallelismElement) && parallelismElement.TryGetInt32(out parallelism)
                && root.TryGetProperty("MemorySize", out var memorySizeElement) && memorySizeElement.TryGetInt32(out memorySize)
                && root.TryGetProperty("Iterations", out var iterationsElement) && iterationsElement.TryGetInt32(out iterations);
        }
        catch (JsonException)
        {
            return false;
        }
    }
}
