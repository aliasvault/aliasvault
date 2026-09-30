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
    /// Gets the default encryption type.
    /// </summary>
    public static string EncryptionType { get; } = "Argon2Id";

    /// <summary>
    /// Gets the default degree of parallelism for Argon2id.
    /// </summary>
    public static int Argon2IdDegreeOfParallelism { get; } = 1;

    /// <summary>
    /// Gets the default memory size for Argon2id (in KB).
    /// </summary>
    public static int Argon2IdMemorySize { get; } = 19456;

    /// <summary>
    /// Gets the default number of iterations for Argon2id.
    /// </summary>
    public static int Argon2IdIterations { get; } = 2;

    /// <summary>
    /// Gets the default encryption settings.
    /// </summary>
    public static string EncryptionSettings { get; } = $"{{\"DegreeOfParallelism\":{Argon2IdDegreeOfParallelism},\"MemorySize\":{Argon2IdMemorySize},\"Iterations\":{Argon2IdIterations}}}";
}
