//-----------------------------------------------------------------------
// <copyright file="ManifestRecord.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync.Models;

/// <summary>
/// One manifest this vault can write, as resolved before canonicalizing. The personal manifest comes first.
/// </summary>
/// <param name="ManifestId">The manifest id.</param>
/// <param name="IsPersonal">Whether this is the caller's own manifest.</param>
/// <param name="Salt">The salt this manifest's blob hashes are derived with.</param>
/// <param name="VaultEncryptionKey">The key this manifest encrypts with (base64).</param>
/// <param name="Name">The display name written into the manifest; null for the personal manifest.</param>
/// <param name="CanAdminister">Whether the caller may publish this manifest's email delivery key.</param>
internal sealed record ManifestRecord(Guid ManifestId, bool IsPersonal, string Salt, string VaultEncryptionKey, string? Name, bool CanAdminister);
