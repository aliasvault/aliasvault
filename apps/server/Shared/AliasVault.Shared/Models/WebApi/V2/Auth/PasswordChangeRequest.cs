//-----------------------------------------------------------------------
// <copyright file="PasswordChangeRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Auth;

/// <summary>
/// Request for POST /v2/Auth/change-password. Carries the new SRP credentials plus the VEK rewrapped
/// with the new password-derived KEK.
/// </summary>
public class PasswordChangeRequest
{
    /// <summary>Gets or sets the client's public ephemeral for the SRP proof of the current password.</summary>
    public required string CurrentClientPublicEphemeral { get; set; }

    /// <summary>Gets or sets the client's session proof for the SRP proof of the current password.</summary>
    public required string CurrentClientSessionProof { get; set; }

    /// <summary>Gets or sets the new SRP/KEK derivation salt.</summary>
    public required string NewPasswordSalt { get; set; }

    /// <summary>Gets or sets the new SRP verifier.</summary>
    public required string NewPasswordVerifier { get; set; }

    /// <summary>Gets or sets the VEK rewrapped with the KEK derived from the new password and new salt.</summary>
    public required string NewWrappedVek { get; set; }
}
