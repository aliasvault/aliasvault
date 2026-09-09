//-----------------------------------------------------------------------
// <copyright file="EncryptionKeyDerivationParams.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync.Models;

/// <summary>
/// The parameters the password-derived key (KEK) is derived with, cached for offline unlock.
/// </summary>
/// <param name="Salt">The Argon2 salt.</param>
/// <param name="EncryptionType">The key derivation type.</param>
/// <param name="EncryptionSettings">The key derivation settings JSON.</param>
public sealed record EncryptionKeyDerivationParams(string Salt, string EncryptionType, string EncryptionSettings);
