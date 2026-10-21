//-----------------------------------------------------------------------
// <copyright file="KeyCertificationInfo.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// One key certification the caller made, as served by GET /v2/Groups/certifications.
/// </summary>
public class KeyCertificationInfo
{
    /// <summary>Gets or sets the user whose key was certified.</summary>
    public required string SubjectUserId { get; set; }

    /// <summary>Gets or sets the certified signing public key (base64).</summary>
    public required string SubjectSigningPublicKey { get; set; }

    /// <summary>Gets or sets the caller's signature over the certification, for the caller's client to check before signing it again.</summary>
    public required string Signature { get; set; }
}
