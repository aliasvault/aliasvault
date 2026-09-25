//-----------------------------------------------------------------------
// <copyright file="VaultPasswordChangeRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V1.PasswordChange;

using AliasVault.Shared.Models.WebApi.V1.Vault;

/// <summary>
/// Represents a request to change the users password including a new vault that is encrypted with the new password.
/// </summary>
public class VaultPasswordChangeRequest : Vault
{
    /// <summary>
    /// Gets or sets the client's public ephemeral for the current password verification.
    /// </summary>
    public required string CurrentClientPublicEphemeral { get; set; }

    /// <summary>
    /// Gets or sets the client's session proof for the current password verification.
    /// </summary>
    public required string CurrentClientSessionProof { get; set; }

    /// <summary>
    /// Gets or sets the new password salt.
    /// </summary>
    public required string NewPasswordSalt { get; set; }

    /// <summary>
    /// Gets or sets the new password verifier.
    /// </summary>
    public required string NewPasswordVerifier { get; set; }
}
