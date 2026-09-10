//-----------------------------------------------------------------------
// <copyright file="AccountKeyHierarchy.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync.Models;

using AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// A newly created account key hierarchy: the plaintext keys this session adopts and the wrapped chain the server stores.
/// </summary>
/// <param name="VaultEncryptionKey">The new VEK (base64), which becomes the session key.</param>
/// <param name="AccountPrivateKey">The private half of the new account keypair as a JWK JSON string.</param>
/// <param name="Keys">The wrapped chain, sent as-is on registration or the migration push.</param>
public sealed record AccountKeyHierarchy(string VaultEncryptionKey, string AccountPrivateKey, AccountKeysUpload Keys);
