//-----------------------------------------------------------------------
// <copyright file="UserSrpCredentials.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

/// <summary>
/// The SRP credentials and KEK derivation parameters that one unlock method authenticates with.
/// </summary>
/// <param name="Salt">The SRP salt.</param>
/// <param name="Verifier">The SRP verifier the server checks a client's proof against.</param>
/// <param name="EncryptionType">The KDF the client derives its KEK with, e.g. Argon2Id.</param>
/// <param name="EncryptionSettings">The parameters belonging to the KDF named by <paramref name="EncryptionType"/>.</param>
/// <param name="UnlockKeyId">The <see cref="UserUnlockKey"/> these credentials came from, or null for a legacy user whose credentials still live on the vault manifest.</param>
public sealed record UserSrpCredentials(string Salt, string Verifier, string EncryptionType, string EncryptionSettings, Guid? UnlockKeyId = null);
