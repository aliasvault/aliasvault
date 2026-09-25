//-----------------------------------------------------------------------
// <copyright file="ResolvedVaultKey.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync.Models;

/// <summary>
/// The keys an unlock method resolves to.
/// </summary>
/// <param name="VaultEncryptionKey">The vault encryption key (VEK) as base64. For a legacy account this is the password-derived key itself.</param>
/// <param name="AccountPrivateKey">The account private key as a JWK JSON string, or null when the session holds none.</param>
/// <param name="IsLegacy">True when the account has no vault key chain yet, so the derived key is the encryption key.</param>
public sealed record ResolvedVaultKey(string VaultEncryptionKey, string? AccountPrivateKey, bool IsLegacy);
