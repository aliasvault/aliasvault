//-----------------------------------------------------------------------
// <copyright file="RestoreLegacyVaultRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.Tests;

#if DEBUG

/// <summary>
/// Request to put a legacy (sqlite-blob) vault on an account from the E2E TestController.
/// Used to test the legacy database upgrade and storage format upgrade paths in client E2E tests to ensure
/// this keeps working in future updates.
///
/// TODO: this model and all related tests can be removed once we no longer support legacy clients (v1.0.0+).
/// </summary>
public class RestoreLegacyVaultRequest
{
    /// <summary>
    /// Gets the encrypted SQLite vault as base64, as the legacy client stored it.
    /// </summary>
    public required string VaultBlob { get; init; }

    /// <summary>
    /// Gets the client database version the vault was written with (e.g. "1.0.0").
    /// </summary>
    public required string Version { get; init; }

    /// <summary>
    /// Gets the SRP salt the vault was written with.
    /// </summary>
    public required string Salt { get; init; }

    /// <summary>
    /// Gets the SRP verifier the vault was written with.
    /// </summary>
    public required string Verifier { get; init; }

    /// <summary>
    /// Gets the SRP identity the verifier was created with.
    /// </summary>
    public required string SrpIdentity { get; init; }

    /// <summary>
    /// Gets the key derivation type (e.g. "Argon2Id").
    /// </summary>
    public required string EncryptionType { get; init; }

    /// <summary>
    /// Gets the key derivation settings as JSON.
    /// </summary>
    public required string EncryptionSettings { get; init; }

    /// <summary>
    /// Gets the revision number to give the vault.
    /// </summary>
    public int RevisionNumber { get; init; } = 2;
}
#endif
