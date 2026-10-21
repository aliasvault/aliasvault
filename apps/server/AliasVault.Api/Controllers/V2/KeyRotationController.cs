//-----------------------------------------------------------------------
// <copyright file="KeyRotationController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.V2;

using System.Security.Claims;
using AliasServerDb;
using AliasServerDb.Retention;
using AliasVault.Api.Controllers.Abstracts;
using AliasVault.Api.Headers;
using AliasVault.Api.Helpers;
using AliasVault.Api.Models;
using AliasVault.Api.Services;
using AliasVault.Auth;
using AliasVault.Cryptography;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi;
using AliasVault.Shared.Models.WebApi.V2.KeyRotation;
using AliasVault.Shared.Models.WebApi.V2.Vault;
using AliasVault.Shared.Server.Services;
using Asp.Versioning;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

/// <summary>
/// Rotates an account's encryption keys: a new Account Key, personal VEK, account keypair and signing keypair, with the
/// personal vault re-encrypted and every grant rewrapped, applied in one transaction or not at all.
/// </summary>
/// <param name="logger">Logger.</param>
/// <param name="dbContextFactory">DbContext factory.</param>
/// <param name="userManager">UserManager.</param>
/// <param name="cache">IMemoryCache instance for persisting SRP values between the initiate and the rotation call.</param>
/// <param name="timeProvider">TimeProvider.</param>
/// <param name="authLoggingService">AuthLoggingService.</param>
[ApiVersion("2")]
public class KeyRotationController(ILogger<KeyRotationController> logger, IAliasServerDbContextFactory dbContextFactory, UserManager<AliasVaultUser> userManager, IMemoryCache cache, TimeProvider timeProvider, AuthLoggingService authLoggingService) : AuthenticatedRequestController(userManager)
{
    /// <summary>
    /// Starts a key rotation: the SRP challenge for the current password, plus the key generations the rotation starts from.
    /// </summary>
    /// <returns>The challenge.</returns>
    [HttpGet("initiate")]
    public async Task<IActionResult> Initiate()
    {
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        await using var context = await dbContextFactory.CreateDbContextAsync();
        var unlockMethod = await context.UserUnlockMethods.FirstOrDefaultAsync(x => x.UserId == user.Id && x.Type == UnlockMethodType.Password);
        var personalManifestId = await GroupHelper.GetPersonalManifestIdAsync(context, user.PersonalGroupId);
        if (unlockMethod == null || personalManifestId == null)
        {
            // Only an account on the key hierarchy has keys to rotate.
            return ApiError.Result(ApiErrorCode.VAULT_KEY_NOT_FOUND, 400);
        }

        var manifestKeyVersion = await context.VaultManifests.Where(x => x.ManifestId == personalManifestId.Value).Select(x => x.KeyVersion).FirstAsync();
        var credentials = await AuthHelper.GetUserLatestVaultEncryptionSettingsAsync(context, user);
        var serverEphemeral = AuthHelper.CreateSrpEphemeral(cache, user, SrpPurpose.KeyRotation, credentials);

        return Ok(new KeyRotationInitiateResponse
        {
            Salt = credentials.Salt,
            ServerEphemeral = serverEphemeral,
            EncryptionType = credentials.EncryptionType,
            EncryptionSettings = credentials.EncryptionSettings,
            SrpIdentity = AuthHelper.GetSrpIdentity(user),
            UserId = user.Id,
            AccountKeyVersion = unlockMethod.AccountKeyVersion,
            PersonalManifestId = personalManifestId.Value,
            ManifestKeyVersion = manifestKeyVersion,
        });
    }

    /// <summary>
    /// Applies a key rotation. Everything is checked against the server state first; the rotation is refused as a whole when
    /// the account moved on since the client computed it, or when it does not cover every blob key and grant the account holds.
    /// </summary>
    /// <param name="model">The rotation.</param>
    /// <returns>The outcome.</returns>
    [HttpPost("")]
    public async Task<IActionResult> Rotate([FromBody] KeyRotationRequest model)
    {
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        await using var context = await dbContextFactory.CreateDbContextAsync();
        var unlockMethod = await context.UserUnlockMethods.FirstOrDefaultAsync(x => x.UserId == user.Id && x.Type == UnlockMethodType.Password);
        if (unlockMethod == null)
        {
            return ApiError.Result(ApiErrorCode.VAULT_KEY_NOT_FOUND, 400);
        }

        var shapeError = await ValidateShapeAsync(context, user, model);
        if (shapeError != null)
        {
            return shapeError;
        }

        // The key rotation mechanism always expects a new salt (via combined mandatory password change): other devices detect the rotation by the changed salt to avoid outdated pushes.
        if (string.Equals(model.UnlockMethod.Salt, VaultKeyMetadata.Parse(unlockMethod.Metadata).Salt, StringComparison.Ordinal))
        {
            return ApiError.Result(ApiErrorCode.INVALID_REQUEST, 400);
        }

        // The current password, proven over SRP; failures count towards the lockout like a login.
        var srpResult = await AuthHelper.ValidateStepUpAsync(cache, context, GetUserManager(), user, SrpPurpose.KeyRotation, model.CurrentClientPublicEphemeral, model.CurrentClientSessionProof);
        if (srpResult.Session is null)
        {
            await authLoggingService.LogAuthEventFailAsync(user.UserName!, AuthEventType.KeyRotation, srpResult.FailureReason);
            return ApiError.Result(srpResult.LockedOut ? ApiErrorCode.ACCOUNT_LOCKED : ApiErrorCode.PASSWORD_MISMATCH, 400);
        }

        var now = timeProvider.GetUtcNow().UtcDateTime;
        var currentRefreshTokenId = Guid.TryParse(User.FindFirstValue(TokenService.RefreshTokenIdClaim), out var tokenId) ? tokenId : Guid.Empty;
        var client = ClientHeaderInfo.GetRawValue(Request);

        var strategy = context.Database.CreateExecutionStrategy();
        var result = await strategy.ExecuteAsync(async () =>
        {
            await using var writeContext = await dbContextFactory.CreateDbContextAsync();
            await using var tx = await writeContext.Database.BeginTransactionAsync();

            var manifest = await writeContext.VaultManifests.FirstOrDefaultAsync(x => x.ManifestId == model.Expected.PersonalManifestId && x.OwnerGroupId == user.PersonalGroupId);
            if (manifest == null)
            {
                return ApiError.Result(ApiErrorCode.INVALID_REQUEST, 400);
            }

            // Claim the unlock method at the expected Account Key version. The row stays locked until commit, so a concurrent
            // rotation or password change waits here and then finds the version moved on.
            var claimed = await writeContext.UserUnlockMethods.Where(x => x.Id == unlockMethod.Id && x.AccountKeyVersion == model.Expected.AccountKeyVersion).ExecuteUpdateAsync(s => s.SetProperty(x => x.UpdatedAt, now));
            if (claimed == 0)
            {
                await tx.RollbackAsync();
                return Ok(await CurrentStateAsync(writeContext, user, KeyRotationStatus.Outdated, manifest.ManifestId));
            }

            var method = await writeContext.UserUnlockMethods.FirstAsync(x => x.Id == unlockMethod.Id);
            var buckets = await writeContext.VaultDataBuckets.Where(x => x.ManifestId == manifest.ManifestId).ToListAsync();
            var heldGrants = await writeContext.VaultManifestAccessKeys.Where(x => x.UserId == user.Id && x.Type == ManifestKeyType.GrantKey).ToListAsync();
            var certifications = await writeContext.UserKeyCertifications.Where(c => c.CertifierUserId == user.Id).ToListAsync();
            var personalAccessKeys = await writeContext.VaultManifestAccessKeys.Where(x => x.UserId == user.Id && x.Type == ManifestKeyType.AccountKey && x.VaultManifestId == manifest.ManifestId).ToListAsync();

            // Revision gate: the rotation was computed against exactly this vault state, or it is not applied.
            if (!ExpectedStateMatches(model.Expected, manifest, buckets))
            {
                await tx.RollbackAsync();
                return Ok(await CurrentStateAsync(writeContext, user, KeyRotationStatus.Outdated, manifest.ManifestId));
            }

            // Completeness gate: a blob key or grant left under the old keys would be unreadable from here on.
            var referencedHashes = (await writeContext.VaultBlobReferences.Where(r => r.ManifestId == manifest.ManifestId && r.RevisionNumber == manifest.RevisionNumber).Select(r => r.BlobHash).ToListAsync()).ToHashSet(StringComparer.Ordinal);
            var rewrappedHashes = model.BlobKeys.Select(b => b.Hash).ToHashSet(StringComparer.Ordinal);
            var writtenHashes = model.Manifest.BlobReferences.Select(b => b.Hash).ToHashSet(StringComparer.Ordinal);
            var heldGrantIds = heldGrants.Select(g => g.VaultManifestId).ToHashSet();
            var rewrappedGrantIds = model.Grants.Select(g => g.ManifestId).ToHashSet();
            var grantVersionsMatch = model.Grants.All(g => heldGrants.Any(h => h.VaultManifestId == g.ManifestId && h.KeyVersion == g.KeyVersion));
            var bucketsCovered = buckets.All(b => model.Buckets.Any(w => w.Category == b.Category));
            var certificationsCovered = certifications.All(c => model.Certifications.Any(w => w.SubjectUserId == c.SubjectUserId && w.SubjectSigningPublicKey == c.SubjectSigningPublicKey)) && model.Certifications.Count == certifications.Count;
            var blobsCovered = rewrappedHashes.SetEquals(referencedHashes) && writtenHashes.SetEquals(referencedHashes);
            var grantsCovered = rewrappedGrantIds.SetEquals(heldGrantIds) && grantVersionsMatch;
            if (!blobsCovered || !grantsCovered || !bucketsCovered || !certificationsCovered || personalAccessKeys.Count == 0)
            {
                await tx.RollbackAsync();
                return ApiError.Result(ApiErrorCode.KEY_ROTATION_INCOMPLETE, 400);
            }

            var newAccountKeyVersion = method.AccountKeyVersion + 1;
            var newKeyVersion = manifest.KeyVersion + 1;

            // 1) The master-password unlock method, rewritten for the new Account Key. Archived passwords open an older Account Key,
            // which no longer reaches any vault key, so the password history is dropped instead of extended.
            await writeContext.UserUnlockMethodsHistory.Where(x => x.UserId == user.Id).ExecuteDeleteAsync();
            var metadata = VaultKeyMetadata.Parse(method.Metadata);
            metadata.Salt = model.UnlockMethod.Salt;
            metadata.SrpVerifier = model.UnlockMethod.Verifier;
            metadata.EncryptionType = model.UnlockMethod.EncryptionType;
            metadata.EncryptionSettings = model.UnlockMethod.EncryptionSettings;
            method.Metadata = metadata.ToJson();
            method.EncryptedAccountKey = model.UnlockMethod.EncryptedAccountKey;
            method.Algorithm = VaultKeyAlgorithms.Parse(model.UnlockMethod.EncryptedAccountKeyAlgorithm);
            method.AccountKeyVersion = newAccountKeyVersion;
            method.UpdatedAt = now;

            // Other account unlock methods still hold the old Account Key, so they are deleted (none exist yet besides the password).
            // TODO: when more unlock methods are added, check this assumption again and update UI warnings if necessary.
            await writeContext.UserUnlockMethods.Where(x => x.UserId == user.Id && x.Id != method.Id).ExecuteDeleteAsync();

            // 2) The personal VEK: the new generation replaces every previous one, as nothing under an older one is kept (see 5).
            writeContext.VaultManifestAccessKeys.RemoveRange(personalAccessKeys);
            writeContext.VaultManifestAccessKeys.Add(new VaultManifestAccessKey
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                VaultManifestId = manifest.ManifestId,
                Type = ManifestKeyType.AccountKey,
                Algorithm = VaultKeyAlgorithm.Aes256Gcm,
                EncryptedVek = model.AccountKeys.EncryptedVek,
                KeyVersion = newKeyVersion,
                AccountKeyVersion = newAccountKeyVersion,
                CreatedAt = now,
                UpdatedAt = now,
            });

            // 3) The account keypairs. Old encryption keypairs are deleted: every grant is rewrapped below and stale invitations are
            // emptied, so nothing references them. Old signing keys stay demoted, as their public halves chain to the new one.
            await writeContext.UserGrantKeys.Where(k => k.UserId == user.Id).ExecuteDeleteAsync();
            await writeContext.UserSigningKeys.Where(k => k.UserId == user.Id && k.IsPrimary).ExecuteUpdateAsync(s => s.SetProperty(k => k.IsPrimary, false).SetProperty(k => k.UpdatedAt, now));
            var grantKey = new UserGrantKey
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                Algorithm = VaultKeyAlgorithm.RsaOaepSha256,
                PublicKey = model.AccountKeys.AccountPublicKey,
                EncryptedPrivateKey = model.AccountKeys.EncryptedAccountPrivateKey,
                PublicKeySignature = model.AccountKeys.AccountPublicKeySignature,
                IsPrimary = true,
                AccountKeyVersion = newAccountKeyVersion,
                CreatedAt = now,
                UpdatedAt = now,
            };
            writeContext.UserGrantKeys.Add(grantKey);
            writeContext.UserSigningKeys.Add(new UserSigningKey
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                Algorithm = SigningKeyAlgorithm.Ed25519,
                PublicKey = model.AccountKeys.SigningPublicKey,
                Fingerprint = Signing.Fingerprint(model.AccountKeys.SigningPublicKey),
                EncryptedPrivateKey = model.AccountKeys.EncryptedSigningPrivateKey,
                PreviousKeySignature = model.AccountKeys.PreviousSigningKeySignature,
                IsPrimary = true,
                AccountKeyVersion = newAccountKeyVersion,
                CreatedAt = now,
                UpdatedAt = now,
            });

            // 4) Every grant this account holds, now encrypted for the new public key and signed by the new signing key.
            foreach (var grant in heldGrants)
            {
                var rewrap = model.Grants.First(g => g.ManifestId == grant.VaultManifestId);
                grant.EncryptedVek = rewrap.EncryptedVek;
                grant.Algorithm = VaultKeyAlgorithms.Parse(rewrap.Algorithm);
                grant.UserGrantKeyId = grantKey.Id;
                grant.GrantSignature = rewrap.Signature;
                grant.GrantSignerUserId = user.Id;
                grant.GrantSignerPublicKey = model.AccountKeys.SigningPublicKey;
                grant.UpdatedAt = now;
            }

            // 4b) Every key certification this account made, signed again with the new signing key, so the people it vouched for stay verified.
            foreach (var certification in certifications)
            {
                certification.Signature = model.Certifications.First(c => c.SubjectUserId == certification.SubjectUserId).Signature;
                certification.UpdatedAt = now;
            }

            // 5) The personal manifest, as a new revision under the new VEK, with the same blob set. Earlier revisions of the manifest
            // and its buckets are encrypted with the old VEK, which no client holds anymore, so they are deleted instead of archived.
            await writeContext.VaultBlobReferences.Where(r => r.ManifestId == manifest.ManifestId).ExecuteDeleteAsync();
            await writeContext.VaultManifestsHistory.Where(h => h.ManifestId == manifest.ManifestId).ExecuteDeleteAsync();
            await writeContext.VaultDataBucketsHistory.Where(h => h.ManifestId == manifest.ManifestId).ExecuteDeleteAsync();

            manifest.VaultBlob = null;
            manifest.StorageFormat = VaultManifestBase.ManifestStorageFormat;
            manifest.ManifestBlob = model.Manifest.Data;
            manifest.ManifestCiphertextHash = model.Manifest.ManifestCiphertextHash;
            manifest.Version = null;
            manifest.KeyVersion = newKeyVersion;
            manifest.RevisionNumber = model.Expected.ManifestRevision + 1;
            manifest.FileSize = FileHelper.BytesToKilobytes(manifest.ManifestBlob.Length);
            manifest.CredentialsCount = model.Manifest.CredentialsCount;
            manifest.Client = client;
            manifest.UpdatedByUserId = user.Id;
            manifest.UpdatedAt = now;
            foreach (var hash in referencedHashes)
            {
                writeContext.VaultBlobReferences.Add(new VaultBlobReference { ManifestId = manifest.ManifestId, RevisionNumber = manifest.RevisionNumber, BlobHash = hash });
            }

            if (!string.IsNullOrEmpty(model.Manifest.DeliveryPublicKey))
            {
                await VaultRevisionWriter.PublishManifestPublicKeyAsync(writeContext, now, manifest.ManifestId, model.Manifest.DeliveryPublicKey, VaultKeyAlgorithms.Parse(model.Manifest.DeliveryPublicKeyAlgorithm));
            }

            // 6) The data buckets and blob keys under the new VEK.
            var bucketRevisions = new List<BucketRevision>();
            foreach (var bucket in model.Buckets)
            {
                var revision = await VaultRevisionWriter.UpsertBucketAsync(writeContext, now, manifest.ManifestId, bucket.Category, bucket.Data, bucket.CiphertextHash, bucket.CurrentRevision, buckets.FirstOrDefault(b => b.Category == bucket.Category), newKeyVersion, archive: false);
                bucketRevisions.Add(new BucketRevision { ManifestId = manifest.ManifestId, Category = bucket.Category, Revision = revision });
            }

            var blobRows = await writeContext.VaultBlobObjects.Where(b => b.ManifestId == manifest.ManifestId && referencedHashes.Contains(b.Hash)).ToListAsync();
            var rewrappedKeys = model.BlobKeys.ToDictionary(b => b.Hash, b => b.EncryptedBlobKey, StringComparer.Ordinal);
            foreach (var blob in blobRows)
            {
                blob.EncryptedBlobKey = rewrappedKeys[blob.Hash];
                blob.KeyVersion = newKeyVersion;
            }

            // Blobs only older revisions referenced keep a key under the old VEK. Delete them now instead of at the next GC sweep: a
            // client re-adding the same content would find the hash present, skip the upload and reference a key nobody can open.
            await writeContext.VaultBlobObjects.Where(b => b.ManifestId == manifest.ManifestId && !referencedHashes.Contains(b.Hash)).ExecuteDeleteAsync();

            // 7) Invitations addressed to this account are encrypted for the old public key and cannot be opened anymore.
            var staleInvitations = await writeContext.GroupInvitations.Where(i => i.InviteeUserId == user.Id && i.State == GroupInvitationState.Pending).ToListAsync();
            foreach (var invitation in staleInvitations)
            {
                invitation.State = GroupInvitationState.Stale;
                invitation.EncryptedVek = null;
                invitation.EncryptedName = null;
                invitation.EncryptedNameSignature = null;
                invitation.UserGrantKeyId = null;
                invitation.GrantSignature = null;
                invitation.GrantSignerPublicKey = null;
                invitation.RespondedAt = now;
                invitation.UpdatedAt = now;
            }

            // 8) Account bookkeeping, and every other session is signed out: their keys no longer open anything.
            await writeContext.AliasVaultUsers.Where(x => x.Id == user.Id).ExecuteUpdateAsync(s => s.SetProperty(x => x.PasswordChangedAt, now));
            await writeContext.AliasVaultUserRefreshTokens.Where(x => x.UserId == user.Id && x.Id != currentRefreshTokenId).ExecuteDeleteAsync();

            await writeContext.SaveChangesAsync();
            await tx.CommitAsync();

            return Ok(new KeyRotationResponse { Status = KeyRotationStatus.Ok, ManifestKeyVersion = newKeyVersion, ManifestRevision = manifest.RevisionNumber, BucketRevisions = bucketRevisions });
        });

        if (result is OkObjectResult { Value: KeyRotationResponse { Status: KeyRotationStatus.Ok } })
        {
            user.PasswordChangedAt = now;
            await authLoggingService.LogAuthEventSuccessAsync(user.UserName!, AuthEventType.KeyRotation);
            logger.LogInformation("Rotated the encryption keys of user {UserName} ({UserId}).", user.UserName, user.Id);
        }

        return result;
    }

    /// <summary>
    /// Whether the personal manifest and its buckets are exactly what the rotation was computed against.
    /// </summary>
    private static bool ExpectedStateMatches(KeyRotationExpectedState expected, VaultManifest manifest, List<VaultDataBucket> buckets)
    {
        if (manifest.RevisionNumber != expected.ManifestRevision || manifest.KeyVersion != expected.ManifestKeyVersion)
        {
            return false;
        }

        // Every bucket the server holds must be named at its current revision; a bucket the server does not hold yet is at 0.
        var expectedRevisions = expected.BucketRevisions.Where(b => b.ManifestId == manifest.ManifestId).ToDictionary(b => b.Category, b => b.Revision);
        return buckets.All(b => expectedRevisions.GetValueOrDefault(b.Category) == b.RevisionNumber) && expectedRevisions.All(e => e.Value == 0 || buckets.Any(b => b.Category == e.Key));
    }

    /// <summary>
    /// The account's current key generations and revisions, reported with a refusal.
    /// </summary>
    private static async Task<KeyRotationResponse> CurrentStateAsync(AliasServerDbContext context, AliasVaultUser user, KeyRotationStatus status, Guid manifestId)
    {
        var manifest = await context.VaultManifests.Where(x => x.ManifestId == manifestId).Select(x => new { x.KeyVersion, x.RevisionNumber }).FirstOrDefaultAsync();
        var bucketRevisions = await context.VaultDataBuckets.Where(x => x.ManifestId == manifestId).Select(x => new BucketRevision { ManifestId = x.ManifestId, Category = x.Category, Revision = x.RevisionNumber }).ToListAsync();
        return new KeyRotationResponse { Status = status, ManifestKeyVersion = manifest?.KeyVersion ?? 0, ManifestRevision = manifest?.RevisionNumber ?? 0, BucketRevisions = bucketRevisions };
    }

    /// <summary>
    /// Checks everything about the request that needs no transaction: sizes, algorithms, ciphertext hashes and signatures.
    /// Every signature is checked against the new signing key, which the rotation stores in the same transaction, except the
    /// new signing key itself, which the current one must vouch for.
    /// </summary>
    /// <returns>Null when the request is well-formed, else the error to answer with.</returns>
    private static async Task<IActionResult?> ValidateShapeAsync(AliasServerDbContext context, AliasVaultUser user, KeyRotationRequest model)
    {
        var unlock = model.UnlockMethod;
        var keys = model.AccountKeys;
        var accountKeyFits = !string.IsNullOrEmpty(unlock.EncryptedAccountKey) && unlock.EncryptedAccountKey.Length <= AccountKeysUpload.MaxWrappedKeyLength;
        if (!UnlockMethodParameterValidator.IsValidKekDerivationParams(unlock.EncryptionType, unlock.EncryptionSettings) || !UnlockMethodParameterValidator.WithinSrpCredentialLimits(unlock.Salt, unlock.Verifier) || !accountKeyFits)
        {
            return ApiError.Result(ApiErrorCode.INVALID_ENCRYPTION_PARAMETERS, 400);
        }

        if (!VaultKeyAlgorithms.TryParse(unlock.EncryptedAccountKeyAlgorithm, out var accountKeyAlgorithm) || VaultKeyAlgorithms.IsAsymmetric(accountKeyAlgorithm))
        {
            return ApiError.Result(ApiErrorCode.INVALID_ALGORITHM, 400);
        }

        if (!keys.FitsStorageLimits || !RsaPublicKeyValidator.IsValid(keys.AccountPublicKey))
        {
            return ApiError.Result(ApiErrorCode.INVALID_REQUEST, 400);
        }

        // Manifest and buckets: one manifest, the personal one, with buckets of its own, each ciphertext matching its hash.
        if (model.Manifest.ManifestId != model.Expected.PersonalManifestId || !CiphertextHelper.IsCiphertext(model.Manifest.Data) || !CiphertextHelper.MatchesHash(model.Manifest.Data, model.Manifest.ManifestCiphertextHash))
        {
            return ApiError.Result(ApiErrorCode.INVALID_REQUEST, 400);
        }

        if (model.Buckets.Select(b => b.Category).Distinct().Count() != model.Buckets.Count || model.Buckets.Any(b => b.ManifestId != model.Manifest.ManifestId || !CiphertextHelper.IsCiphertext(b.Data) || !CiphertextHelper.MatchesHash(b.Data, b.CiphertextHash)))
        {
            return ApiError.Result(ApiErrorCode.INVALID_REQUEST, 400);
        }

        if (model.BlobKeys.Select(b => b.Hash).Distinct(StringComparer.Ordinal).Count() != model.BlobKeys.Count || model.Grants.Select(g => g.ManifestId).Distinct().Count() != model.Grants.Count || model.Certifications.Select(c => c.SubjectUserId).Distinct(StringComparer.Ordinal).Count() != model.Certifications.Count)
        {
            return ApiError.Result(ApiErrorCode.INVALID_REQUEST, 400);
        }

        if (model.Grants.Any(g => !VaultKeyAlgorithms.TryParse(g.Algorithm, out var grantAlgorithm) || !VaultKeyAlgorithms.IsAsymmetric(grantAlgorithm)))
        {
            return ApiError.Result(ApiErrorCode.INVALID_ALGORITHM, 400);
        }

        var deliveryKey = model.Manifest.DeliveryPublicKey;
        if (!string.IsNullOrEmpty(deliveryKey) && (!VaultKeyAlgorithms.TryParse(model.Manifest.DeliveryPublicKeyAlgorithm, out var deliveryAlgorithm) || !VaultKeyAlgorithms.IsAsymmetric(deliveryAlgorithm) || !RsaPublicKeyValidator.IsValid(deliveryKey)))
        {
            return ApiError.Result(ApiErrorCode.INVALID_REQUEST, 400);
        }

        // Signatures: the new signing key vouches for the new account public key, every grant, the delivery key and every
        // key certification; the current signing key vouches for the new signing key.
        var currentSigningKey = await GrantHelper.GetPrimarySigningKeyAsync(context, user.Id);
        var signingKeyIsVouchedFor = Signing.Verify(currentSigningKey, Signing.SigningKeyRotationMessage(user.Id, keys.SigningPublicKey), keys.PreviousSigningKeySignature);
        var accountKeyIsSigned = Signing.VerifyAccountPublicKey(keys.SigningPublicKey, keys.AccountPublicKey, keys.AccountPublicKeySignature);
        var grantsAreSigned = model.Grants.All(g => Signing.Verify(keys.SigningPublicKey, Signing.GrantMessage(g.ManifestId, g.KeyVersion, user.Id, keys.AccountPublicKey, g.Algorithm, g.EncryptedVek), g.Signature));
        var deliveryKeyIsSigned = string.IsNullOrEmpty(deliveryKey) || Signing.Verify(keys.SigningPublicKey, Signing.DeliveryKeyMessage(model.Manifest.ManifestId, deliveryKey, model.Manifest.CurrentRevision), model.Manifest.DeliveryPublicKeySignature);
        var certificationsAreSigned = model.Certifications.All(c => Signing.Verify(keys.SigningPublicKey, Signing.KeyCertificationMessage(user.Id, c.SubjectUserId, c.SubjectSigningPublicKey), c.Signature));
        if (!signingKeyIsVouchedFor || !accountKeyIsSigned || !grantsAreSigned || !deliveryKeyIsSigned || !certificationsAreSigned)
        {
            return ApiError.Result(ApiErrorCode.SIGNATURE_INVALID, 400);
        }

        return null;
    }
}
