//-----------------------------------------------------------------------
// <copyright file="CertifyKeyRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// Store the caller's certification of another user's signing key (POST /v2/Groups/certifications).
/// </summary>
public class CertifyKeyRequest
{
    /// <summary>Gets or sets the user the key belongs to.</summary>
    public required string SubjectUserId { get; set; }

    /// <summary>Gets or sets the certified signing public key (base64), which must be the subject's current one.</summary>
    public required string SubjectSigningPublicKey { get; set; }

    /// <summary>Gets or sets the caller's signature over the key certification message.</summary>
    public required string Signature { get; set; }
}
