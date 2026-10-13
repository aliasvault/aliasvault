//-----------------------------------------------------------------------
// <copyright file="AccountKeyHierarchyHelper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using AliasServerDb;
using AliasVault.Cryptography;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Validates and stores a client-uploaded account key hierarchy, for registration and the legacy vault migration.
/// </summary>
public static class AccountKeyHierarchyHelper
{
    /// <summary>
    /// Validates an uploaded account key hierarchy, including the signing key's signature over the account public key.
    /// </summary>
    /// <param name="keys">The uploaded keys.</param>
    /// <param name="unlockKeyAlgorithm">The parsed algorithm of the encrypted Account Key, when valid.</param>
    /// <returns>Null when valid, else the error code to answer with.</returns>
    public static ApiErrorCode? Validate(AccountKeysUpload keys, out VaultKeyAlgorithm unlockKeyAlgorithm)
    {
        unlockKeyAlgorithm = default;

        // Reject an incomplete or oversized hierarchy before any row is written.
        if (!keys.IsComplete || !keys.FitsStorageLimits || !RsaPublicKeyValidator.IsValid(keys.AccountPublicKey))
        {
            return ApiErrorCode.INVALID_REQUEST;
        }

        if (!Signing.VerifyAccountPublicKey(keys.SigningPublicKey, keys.AccountPublicKey, keys.AccountPublicKeySignature))
        {
            return ApiErrorCode.INVALID_REQUEST;
        }

        if (!VaultKeyAlgorithms.TryParse(keys.EncryptedAccountKeyAlgorithm, out unlockKeyAlgorithm) || VaultKeyAlgorithms.IsAsymmetric(unlockKeyAlgorithm))
        {
            return ApiErrorCode.INVALID_ALGORITHM;
        }

        return null;
    }

    /// <summary>
    /// Adds the password unlock key, grant key, signing key and personal manifest access key rows of a validated hierarchy to the context.
    /// </summary>
    /// <param name="context">Database context, inside the caller's unit of work.</param>
    /// <param name="userId">The account owning the keys.</param>
    /// <param name="personalManifestId">The account's personal manifest.</param>
    /// <param name="keys">The keys, already accepted by <see cref="Validate"/>.</param>
    /// <param name="unlockKeyAlgorithm">The algorithm returned by <see cref="Validate"/>.</param>
    /// <param name="srpCredentials">The password unlock key's KDF parameters and SRP credentials.</param>
    /// <param name="now">The creation time.</param>
    public static void AddEntities(AliasServerDbContext context, string userId, Guid personalManifestId, AccountKeysUpload keys, VaultKeyAlgorithm unlockKeyAlgorithm, VaultKeyMetadata srpCredentials, DateTime now)
    {
        context.UserUnlockKeys.Add(new UserUnlockKey
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Type = UnlockMethodType.Password,
            Algorithm = unlockKeyAlgorithm,
            EncryptedAccountKey = keys.EncryptedAccountKey!,
            Metadata = srpCredentials.ToJson(),
            CreatedAt = now,
            UpdatedAt = now,
        });

        context.UserGrantKeys.Add(new UserGrantKey
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Algorithm = VaultKeyAlgorithm.RsaOaepSha256,
            PublicKey = keys.AccountPublicKey!,
            EncryptedPrivateKey = keys.EncryptedAccountPrivateKey!,
            PublicKeySignature = keys.AccountPublicKeySignature!,
            IsPrimary = true,
            CreatedAt = now,
            UpdatedAt = now,
        });

        context.UserSigningKeys.Add(new UserSigningKey
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Algorithm = SigningKeyAlgorithm.Ed25519,
            PublicKey = keys.SigningPublicKey!,
            EncryptedPrivateKey = keys.EncryptedSigningPrivateKey!,
            IsPrimary = true,
            CreatedAt = now,
            UpdatedAt = now,
        });

        context.VaultManifestAccessKeys.Add(new VaultManifestAccessKey
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            VaultManifestId = personalManifestId,
            Type = ManifestKeyType.AccountKey,
            Algorithm = VaultKeyAlgorithm.Aes256Gcm,
            EncryptedVek = keys.EncryptedVek!,
            AccountKeyVersion = 0,
            CreatedAt = now,
            UpdatedAt = now,
        });
    }
}
