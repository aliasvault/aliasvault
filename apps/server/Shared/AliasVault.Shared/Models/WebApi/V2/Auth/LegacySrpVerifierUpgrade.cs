//-----------------------------------------------------------------------
// <copyright file="LegacySrpVerifierUpgrade.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Auth;

/// <summary>
/// The verifier of the same password and salt under the current encryption type, sent once with a login that answered
/// a legacy (pre-0.31.0, <c>Argon2Id</c>) verifier. TODO: remove once no legacy verifiers are left and/or we stop supporting pre-0.31.0 accounts.
/// </summary>
public class LegacySrpVerifierUpgrade
{
    /// <summary>
    /// Gets or sets the upgraded SRP verifier.
    /// </summary>
    public string SrpVerifier { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the encryption type <see cref="SrpVerifier"/> was made with.
    /// </summary>
    public string EncryptionType { get; set; } = string.Empty;
}
