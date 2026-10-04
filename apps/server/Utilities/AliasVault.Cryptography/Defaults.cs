//-----------------------------------------------------------------------
// <copyright file="Defaults.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Cryptography;

/// <summary>
/// Cryptography defaults.
/// </summary>
public static class Defaults
{
    /// <summary>
    /// Gets the encryption type of new verifiers: Argon2id, with the SRP input and the KEK each derived from its output
    /// with HKDF. Every v2 registration and password change uses it.
    /// </summary>
    public static string EncryptionType { get; } = "Argon2IdHkdf";

    /// <summary>
    /// Gets the encryption type of verifiers made from the Argon2id output itself, created before the SRP input was
    /// split off. A v2 password login upgrades them to <see cref="EncryptionType"/>; v1 clients only know this one.
    /// </summary>
    public static string LegacyEncryptionType { get; } = "Argon2Id";

    /// <summary>
    /// Gets the default degree of parallelism for Argon2id.
    /// </summary>
    public static int Argon2IdDegreeOfParallelism { get; } = 1;

    /// <summary>
    /// Gets the default memory size for Argon2id (in KiB).
    /// </summary>
    public static int Argon2IdMemorySize { get; } = 65536;

    /// <summary>
    /// Gets the default number of iterations for Argon2id.
    /// </summary>
    public static int Argon2IdIterations { get; } = 5;

    /// <summary>
    /// Gets the default encryption settings.
    /// </summary>
    public static string EncryptionSettings { get; } = $"{{\"DegreeOfParallelism\":{Argon2IdDegreeOfParallelism},\"MemorySize\":{Argon2IdMemorySize},\"Iterations\":{Argon2IdIterations}}}";

    /*
     * The lowest Argon2id parameters the server accepts for a new KEK: the pre-0.31.0 defaults, so clients built before
     * the defaults were raised can still register and change passwords for one more release with the old parameters.
     * TODO: remove in 0.32.0+ and enforce the current defaults (Argon2Id* above) as the minimum instead.
     */

    /// <summary>
    /// Gets the minimum accepted degree of parallelism for Argon2id.
    /// </summary>
    public static int MinimumArgon2IdDegreeOfParallelism { get; } = 1;

    /// <summary>
    /// Gets the minimum accepted memory size for Argon2id (in KiB).
    /// </summary>
    public static int MinimumArgon2IdMemorySize { get; } = 19456;

    /// <summary>
    /// Gets the minimum accepted number of iterations for Argon2id.
    /// </summary>
    public static int MinimumArgon2IdIterations { get; } = 2;
}
