//-----------------------------------------------------------------------
// <copyright file="SharedManifestEncryptionPublicKey.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// The public half of a shared manifest's email keypair, published so the SMTP service can encrypt mail
/// for the manifest's aliases. The private half never leaves the manifest.
/// </summary>
public class SharedManifestEncryptionPublicKey
{
    /// <summary>Gets or sets the shared manifest this key belongs to.</summary>
    public required Guid ManifestId { get; set; }

    /// <summary>Gets or sets the public key to publish as the manifest's active delivery key.</summary>
    public required string PublicKey { get; set; }
}
