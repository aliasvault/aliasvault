//-----------------------------------------------------------------------
// <copyright file="SharedManifestRecord.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync.Models;

/// <summary>
/// A shared manifest this session holds a grant on, as rebuilt from the last pull.
/// </summary>
/// <param name="ManifestId">The manifest id.</param>
/// <param name="EncryptedVek">The manifest VEK sealed to one of this account's public keys (the grant as the server holds it).</param>
/// <param name="EncryptionPublicKey">The public key the grant was sealed with.</param>
/// <param name="Algorithm">The grant algorithm token.</param>
/// <param name="Salt">The manifest's blob-hashing salt.</param>
/// <param name="Name">The manifest display name, or null when unknown.</param>
/// <param name="CanAdminister">Whether this account may administer the manifest.</param>
/// <param name="VaultEncryptionKey">The unwrapped manifest VEK as base64. Held in memory only; it dies with the session.</param>
public sealed record SharedManifestRecord(Guid ManifestId, string EncryptedVek, string EncryptionPublicKey, string Algorithm, string Salt, string? Name, bool CanAdminister, string VaultEncryptionKey);
