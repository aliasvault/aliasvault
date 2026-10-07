//-----------------------------------------------------------------------
// <copyright file="VaultController.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Controllers.V2;

using AliasServerDb;
using AliasVault.Api.Controllers.Abstracts;
using AliasVault.Api.Helpers;
using AliasVault.Api.Models;
using AliasVault.Api.Services;
using AliasVault.Api.Vault;
using AliasVault.Api.Vault.RetentionRules;
using AliasVault.Cryptography;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi;
using AliasVault.Shared.Models.WebApi.V2.Vault;
using Asp.Versioning;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Vault v2 controller. This controller implements the manifest-v1 storage format with separate encrypted manifest,
/// metadata, and content-addressed blob storage.
/// </summary>
/// <param name="logger">ILogger instance.</param>
/// <param name="dbContextFactory">DbContext factory.</param>
/// <param name="userManager">UserManager.</param>
/// <param name="timeProvider">Time provider.</param>
/// <param name="config">Server config.</param>
/// <param name="rateLimitService">RateLimitService instance.</param>
[ApiVersion("2")]

public class VaultController(
    ILogger<VaultController> logger,
    IAliasServerDbContextFactory dbContextFactory,
    UserManager<AliasVaultUser> userManager,
    TimeProvider timeProvider,
    Config config,
    RateLimitService rateLimitService) : AuthenticatedRequestController(userManager)
{
    /// <summary>
    /// Retention policy for superseded bucket revisions.
    /// </summary>
    private static readonly RetentionPolicy _bucketRetentionPolicy = new()
    {
        Rules =
        [
            new RevisionRetentionRule { RevisionsToKeep = 3 },
            new DailyRetentionRule { DaysToKeep = 7 },
        ],
    };

    /// <summary>
    /// Retention policy for superseded manifest revisions.
    /// </summary>
    private readonly RetentionPolicy _manifestRetentionPolicy = new()
    {
        Rules =
        [
            new RevisionRetentionRule { RevisionsToKeep = 3 },
            new DailyRetentionRule { DaysToKeep = 2 },
            new WeeklyRetentionRule { WeeksToKeep = 1 },
            new MonthlyRetentionRule { MonthsToKeep = 1 },
            new DbVersionRetentionRule { VersionsToKeep = 2 },
        ],
    };

    /// <summary>
    /// Atomic snapshot. Returns the latest encrypted manifest + metadata + blob refs + email routing as a <see cref="BinaryFrame"/>.
    /// </summary>
    /// <returns>Snapshot frame.</returns>
    [HttpGet("")]
    public async Task<IActionResult> Get()
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        var accessScope = await ManifestAccessHelper.ResolveScopeAsync(context, user.Id, user.PersonalGroupId);

        // Every manifest the caller can open.
        var latestManifests = await AccessibleManifests(context, accessScope)
            .Select(x => new { x.ManifestId, x.ManifestBlob, x.ManifestCiphertextHash, x.RevisionNumber, x.OwnerGroupId, OwnerGroupType = x.OwnerGroup.Type })
            .ToListAsync();

        if (!latestManifests.Any(m => m.OwnerGroupId == user.PersonalGroupId))
        {
            // User hasn't migrated to manifest-v1 yet, return the latest legacy SQLite blob.
            var legacy = await context.VaultManifests
                .Where(x => x.OwnerGroupId == user.PersonalGroupId)
                .OrderByDescending(x => x.RevisionNumber)
                .FirstOrDefaultAsync();

            var legacyResponse = new GetResponse
            {
                StorageFormat = StorageFormat.SqliteBlob,
                LegacyVaultBlob = legacy?.VaultBlob ?? string.Empty,
                Version = legacy?.Version ?? string.Empty,
                LegacyRevision = legacy?.RevisionNumber ?? 0,
                PersonalManifestId = legacy?.ManifestId,
            };
            return File(BinaryFrame.Write(legacyResponse), BinaryFrame.ContentType);
        }

        var manifestIds = latestManifests.Select(m => m.ManifestId).ToList();
        var buckets = await context.VaultDataBuckets
            .Where(x => manifestIds.Contains(x.ManifestId))
            .Select(x => new Bucket
            {
                ManifestId = x.ManifestId,
                Category = x.Category,
                Data = x.EncryptedData,
                CiphertextHash = x.CiphertextHash,
                Revision = x.RevisionNumber,
            })
            .ToListAsync();

        var refsByManifest = (await AccessibleManifests(context, accessScope)
                .Join(context.VaultBlobReferences, m => new { m.ManifestId, m.RevisionNumber }, r => new { r.ManifestId, r.RevisionNumber }, (m, r) => r)
                .Join(context.VaultBlobObjects, r => new { r.ManifestId, Hash = r.BlobHash }, b => new { b.ManifestId, b.Hash }, (r, b) => new { r.ManifestId, b.Hash, b.Category, b.SizeBytes })
                .ToListAsync())
            .GroupBy(x => x.ManifestId)
            .ToDictionary(g => g.Key, g => g.Select(x => new BlobReference { Hash = x.Hash, Category = x.Category, SizeBytes = x.SizeBytes }).ToList());

        var accessKeysByManifest = await GetAccessKeysAsync(context, user.Id, manifestIds);
        var accountPublicKeys = await GetAccountPublicKeysAsync(context, accessKeysByManifest.Values.Where(g => g.UserGrantKeyId != null).Select(g => g.UserGrantKeyId!.Value));
        var administeredGroupIds = await GroupHelper.GetAdministeredGroupIdsAsync(context, user.Id);

        var manifests = latestManifests.Select(m =>
        {
            accessKeysByManifest.TryGetValue(m.ManifestId, out var accessKey);

            // An account-key row's ciphertext is not sent: the caller decrypted that VEK from their password chain before this call.
            var grant = accessKey != null && ManifestKeyTypes.VekTravelsWithManifest(accessKey.Type) ? accessKey : null;
            return new Manifest
            {
                ManifestId = m.ManifestId,
                Data = m.ManifestBlob ?? [],
                CiphertextHash = m.ManifestCiphertextHash,
                Revision = m.RevisionNumber,
                BlobReferences = refsByManifest.TryGetValue(m.ManifestId, out var refs) ? refs : [],
                CanAdminister = m.OwnerGroupType == GroupType.Shared && administeredGroupIds.Contains(m.OwnerGroupId) && grant != null,
                KeyType = accessKey != null ? ManifestKeyTypes.ToToken(accessKey.Type) : null,
                EncryptedVek = grant?.EncryptedVek,
                Algorithm = grant != null ? VaultKeyAlgorithms.ToToken(grant.Algorithm) : null,
                AccountPublicKey = grant?.UserGrantKeyId != null ? accountPublicKeys.GetValueOrDefault(grant.UserGrantKeyId.Value) : null,
                GrantSignature = grant?.GrantSignature,
                GrantSignerUserId = grant?.GrantSignerUserId,
                GrantSignerPublicKey = grant?.GrantSignerPublicKey,
                KeyVersion = grant?.KeyVersion ?? 0,
            };
        }).ToList();

        var response = new GetResponse
        {
            StorageFormat = StorageFormat.Manifest,
            Manifests = manifests,
            PersonalManifestId = latestManifests.First(m => m.OwnerGroupId == user.PersonalGroupId).ManifestId,
            Buckets = buckets,
        };
        return File(BinaryFrame.Write(response), BinaryFrame.ContentType);
    }

    /// <summary>
    /// Single-manifest fetch. Returns the latest revision of one logical manifest (by ManifestId)
    /// plus its blob references, without the rest of the snapshot.
    /// </summary>
    /// <param name="manifestId">The stable identifier of the logical manifest to fetch.</param>
    /// <returns>The manifest as a <see cref="BinaryFrame"/>, or 404 when the user has no such manifest-v1 manifest.</returns>
    [HttpGet("manifest/{manifestId:guid}")]
    public async Task<IActionResult> GetManifest(Guid manifestId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        // The caller can fetch a manifest owned by a group they own, or one granted to them (a shared manifest).
        var accessScope = await ManifestAccessHelper.ResolveScopeAsync(context, user.Id, user.PersonalGroupId);
        var latest = await AccessibleManifests(context, accessScope).FirstOrDefaultAsync(x => x.ManifestId == manifestId);

        if (latest == null)
        {
            return ApiError.Result(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404);
        }

        var blobRefs = (await context.VaultBlobReferences
                .Where(r => r.ManifestId == latest.ManifestId && r.RevisionNumber == latest.RevisionNumber)
                .Join(context.VaultBlobObjects, r => new { r.ManifestId, Hash = r.BlobHash }, b => new { b.ManifestId, b.Hash }, (r, b) => new { b.Hash, b.Category, b.SizeBytes })
                .ToListAsync())
            .Select(x => new BlobReference { Hash = x.Hash, Category = x.Category, SizeBytes = x.SizeBytes })
            .ToList();

        var manifest = new Manifest
        {
            ManifestId = latest.ManifestId,
            Data = latest.ManifestBlob ?? [],
            CiphertextHash = latest.ManifestCiphertextHash,
            Revision = latest.RevisionNumber,
            BlobReferences = blobRefs,
        };

        // How this manifest's VEK reaches the caller.
        var accessKey = (await GetAccessKeysAsync(context, user.Id, [latest.ManifestId])).GetValueOrDefault(latest.ManifestId);
        manifest.KeyType = accessKey != null ? ManifestKeyTypes.ToToken(accessKey.Type) : null;
        if (accessKey != null && ManifestKeyTypes.VekTravelsWithManifest(accessKey.Type))
        {
            manifest.EncryptedVek = accessKey.EncryptedVek;
            manifest.Algorithm = VaultKeyAlgorithms.ToToken(accessKey.Algorithm);
            manifest.GrantSignature = accessKey.GrantSignature;
            manifest.GrantSignerUserId = accessKey.GrantSignerUserId;
            manifest.GrantSignerPublicKey = accessKey.GrantSignerPublicKey;
            manifest.KeyVersion = accessKey.KeyVersion;
            if (accessKey.UserGrantKeyId != null)
            {
                manifest.AccountPublicKey = await context.UserGrantKeys.Where(k => k.Id == accessKey.UserGrantKeyId).Select(k => k.PublicKey).FirstOrDefaultAsync();
            }
        }

        // Administer rights are only meaningful on a manifest that is not the caller's own home one.
        if (latest.OwnerGroupId != user.PersonalGroupId)
        {
            manifest.CanAdminister = await GroupHelper.IsGroupAdminAsync(context, latest.OwnerGroupId, user.Id);
        }

        return File(BinaryFrame.Write(manifest), BinaryFrame.ContentType);
    }

    /// <summary>
    /// Exact encrypted storage per accessible manifest: the current manifest, buckets and referenced blobs.
    /// </summary>
    /// <returns>Storage statistics DTO.</returns>
    [HttpGet("storage")]
    public async Task<IActionResult> GetStorageStatistics()
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        var accessScope = await ManifestAccessHelper.ResolveScopeAsync(context, user.Id, user.PersonalGroupId);
        var manifests = await AccessibleManifests(context, accessScope)
            .Select(m => new { m.ManifestId, m.OwnerGroupId, ManifestBytes = m.ManifestBlob != null ? (long)m.ManifestBlob.Length : 0 })
            .ToListAsync();
        var manifestIds = manifests.Select(m => m.ManifestId).ToList();

        var bucketBytes = await context.VaultDataBuckets
            .Where(b => manifestIds.Contains(b.ManifestId))
            .GroupBy(b => b.ManifestId)
            .Select(g => new { ManifestId = g.Key, Bytes = g.Sum(b => (long)b.EncryptedData.Length) })
            .ToDictionaryAsync(x => x.ManifestId, x => x.Bytes);

        // Blobs referenced by the current revision of each manifest.
        var currentBlobs = await context.VaultBlobReferences
            .Where(r => manifestIds.Contains(r.ManifestId) && context.VaultManifests.Any(m => m.ManifestId == r.ManifestId && m.RevisionNumber == r.RevisionNumber))
            .Join(context.VaultBlobObjects, r => new { r.ManifestId, Hash = r.BlobHash }, b => new { b.ManifestId, b.Hash }, (r, b) => new { b.ManifestId, b.Category, b.SizeBytes })
            .GroupBy(x => new { x.ManifestId, x.Category })
            .Select(g => new { g.Key.ManifestId, g.Key.Category, Count = g.Count(), Bytes = g.Sum(x => (long)x.SizeBytes) })
            .ToListAsync();

        var response = new StorageStatisticsResponse
        {
            Manifests = manifests.Select(m => new ManifestStorageStatistics
            {
                ManifestId = m.ManifestId,
                IsPersonal = m.OwnerGroupId == user.PersonalGroupId,
                ManifestBytes = m.ManifestBytes,
                BucketBytes = bucketBytes.GetValueOrDefault(m.ManifestId),
                Blobs = currentBlobs.Where(b => b.ManifestId == m.ManifestId).Select(b => new BlobCategoryStatistics { Category = b.Category, Count = b.Count, Bytes = b.Bytes }).ToList(),
            }).ToList(),
        };

        return Ok(response);
    }

    /// <summary>
    /// Unified atomic write. Applies any number of changed manifests (personal and/or shared) and changed data buckets in a single
    /// all-or-nothing DB transaction. Blobs are uploaded beforehand through POST v2/Vault/blobs.
    /// </summary>
    /// <param name="model">Vault write request DTO.</param>
    /// <returns>Vault write response DTO.</returns>
    [HttpPost("")]
    public async Task<IActionResult> Write([FromBody] VaultWriteRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        if (!string.Equals(user.UserName, model.Username, StringComparison.OrdinalIgnoreCase))
        {
            return ApiError.Result(ApiErrorCode.USERNAME_MISMATCH, 400);
        }

        // Each manifest and each (manifest, bucket kind) may appear at most once.
        if (model.Manifests.Select(m => m.ManifestId).Distinct().Count() != model.Manifests.Count
            || model.Buckets.Select(b => (b.ManifestId, b.Category)).Distinct().Count() != model.Buckets.Count)
        {
            return ApiError.Result(ApiErrorCode.INVALID_REQUEST, 400);
        }

        // A routing push names the revision it was built from for every manifest it speaks for, once each.
        if (model.EmailRouting is { } routing)
        {
            var baseIds = routing.BaseRevisions.Select(r => r.ManifestId).ToList();
            var spokenFor = routing.CoveredManifestIds.Concat(routing.EmailAddressList.Select(a => a.ManifestId));
            if (baseIds.Distinct().Count() != baseIds.Count || spokenFor.Any(id => !baseIds.Contains(id)))
            {
                return ApiError.Result(ApiErrorCode.INVALID_REQUEST, 400);
            }
        }

        // Check each ciphertext against the hash the client computed for it.
        var manifestBlobs = new Dictionary<Guid, byte[]>();
        foreach (var mw in model.Manifests)
        {
            if (!CiphertextHelper.IsCiphertext(mw.Data) || !CiphertextHelper.MatchesHash(mw.Data, mw.ManifestCiphertextHash))
            {
                return ApiError.Result(ApiErrorCode.INVALID_REQUEST, 400);
            }

            manifestBlobs[mw.ManifestId] = mw.Data;
        }

        var bucketBlobs = new Dictionary<(Guid ManifestId, VaultDataBucketCategory Category), byte[]>();
        foreach (var bucket in model.Buckets.Where(b => b.Data.Length > 0))
        {
            if (!CiphertextHelper.IsCiphertext(bucket.Data) || !CiphertextHelper.MatchesHash(bucket.Data, bucket.CiphertextHash))
            {
                return ApiError.Result(ApiErrorCode.INVALID_REQUEST, 400);
            }

            bucketBlobs[(bucket.ManifestId, bucket.Category)] = bucket.Data;
        }

        var accessScope = await ManifestAccessHelper.ResolveScopeAsync(context, user.Id, user.PersonalGroupId);

        var resolved = new List<(ManifestWrite Write, VaultManifest Row)>();
        foreach (var mw in model.Manifests)
        {
            var row = await ManifestAccessHelper.AccessibleManifests(context, accessScope).FirstOrDefaultAsync(x => x.ManifestId == mw.ManifestId);
            if (row == null)
            {
                return ApiError.Result(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404);
            }

            resolved.Add((mw, row));
        }

        foreach (var bucketManifestId in model.Buckets.Select(b => b.ManifestId).Distinct())
        {
            if (resolved.Any(r => r.Row.ManifestId == bucketManifestId))
            {
                continue;
            }

            if (!await ManifestAccessHelper.AccessibleManifests(context, accessScope).AnyAsync(x => x.ManifestId == bucketManifestId))
            {
                return ApiError.Result(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404);
            }
        }

        // The caller's own manifest is the one owned by their personal group; a personal group owns no other.
        var personalWrite = resolved.FirstOrDefault(r => r.Row.OwnerGroupId == user.PersonalGroupId).Write;

        // Account-key migration: a legacy vault's first manifest-v1 push includes a newly created Account Key hierarchy, which is accepted exactly once.
        // Every later personal write must find the stored password unlock key. TODO: remove once legacy accounts are no longer supported.
        var accountKeys = model.Migration?.AccountKeys;
        var hasExistingUnlockKey = await context.UserUnlockKeys.AnyAsync(x => x.UserId == user.Id && x.Type == UnlockMethodType.Password);
        if (accountKeys != null)
        {
            if (hasExistingUnlockKey)
            {
                return ApiError.Result(ApiErrorCode.VAULT_KEY_ALREADY_EXISTS, 400);
            }

            if (personalWrite == null || !accountKeys.IsComplete)
            {
                return ApiError.Result(ApiErrorCode.INVALID_REQUEST, 400);
            }

            if (!accountKeys.FitsStorageLimits || !RsaPublicKeyValidator.IsValid(accountKeys.AccountPublicKey) || !Signing.VerifyAccountPublicKey(accountKeys.SigningPublicKey, accountKeys.AccountPublicKey, accountKeys.AccountPublicKeySignature))
            {
                return ApiError.Result(ApiErrorCode.INVALID_REQUEST, 400);
            }

            if (!VaultKeyAlgorithms.TryParse(accountKeys.EncryptedAccountKeyAlgorithm, out var unlockKeyAlgorithm) || VaultKeyAlgorithms.IsAsymmetric(unlockKeyAlgorithm))
            {
                return ApiError.Result(ApiErrorCode.INVALID_ALGORITHM, 400);
            }
        }
        else if (personalWrite != null && !hasExistingUnlockKey)
        {
            return ApiError.Result(ApiErrorCode.VAULT_KEY_NOT_FOUND, 400);
        }

        // All-or-nothing revision gate: every manifest and bucket must be exactly one ahead of the server's current.
        // On any staleness, reject the whole write with Outdated and hand back the current revisions to pull/merge.
        var writeManifestIds = model.Buckets.Select(b => b.ManifestId).Distinct().ToList();
        var writeCategories = model.Buckets.Select(b => b.Category).Distinct().ToList();
        var bucketRows = await context.VaultDataBuckets
            .Where(x => writeManifestIds.Contains(x.ManifestId) && writeCategories.Contains(x.Category))
            .ToDictionaryAsync(x => (x.ManifestId, x.Category));
        var bucketCurrentRevisions = model.Buckets.ToDictionary(
            b => (b.ManifestId, b.Category),
            b => bucketRows.TryGetValue((b.ManifestId, b.Category), out var row) ? row.RevisionNumber : 0);

        var manifestStale = resolved.Any(r => r.Row.RevisionNumber >= r.Write.CurrentRevision + 1);
        var bucketStale = model.Buckets.Any(b => bucketCurrentRevisions[(b.ManifestId, b.Category)] >= b.CurrentRevision + 1);

        // The routing set is built from the manifests the client read, so it is stale when any of them moved on since.
        List<ManifestRevision> routingBaseRevisions = model.EmailRouting?.BaseRevisions ?? [];
        var routingBaseIds = routingBaseRevisions.Select(r => r.ManifestId).Distinct().ToList();
        var routingCurrentRevisions = routingBaseIds.Count == 0 ? new Dictionary<Guid, long>() : await ManifestAccessHelper.AccessibleManifests(context, accessScope)
            .Where(x => routingBaseIds.Contains(x.ManifestId))
            .ToDictionaryAsync(x => x.ManifestId, x => x.RevisionNumber);
        var routingStale = routingBaseRevisions.Where(r => routingCurrentRevisions.TryGetValue(r.ManifestId, out var current) && current > r.Revision).Select(r => r.ManifestId).Distinct().ToList();

        if (manifestStale || bucketStale || routingStale.Count > 0)
        {
            var staleRoutingOnly = routingStale.Where(id => resolved.All(r => r.Row.ManifestId != id));
            return Ok(new VaultWriteResponse
            {
                Status = VaultWriteStatus.Outdated,
                ManifestRevisions = resolved.Select(r => new ManifestWriteResult { ManifestId = r.Write.ManifestId, Revision = r.Row.RevisionNumber })
                    .Concat(staleRoutingOnly.Select(id => new ManifestWriteResult { ManifestId = id, Revision = routingCurrentRevisions[id] }))
                    .ToList(),
                BucketRevisions = model.Buckets.Select(b => new BucketRevision { ManifestId = b.ManifestId, Category = b.Category, Revision = bucketCurrentRevisions[(b.ManifestId, b.Category)] }).ToList(),
            });
        }

        // The SMTP service encrypts every incoming mail with the primary delivery key, so a malformed one would lose that mail.
        if (resolved.Any(r => !string.IsNullOrEmpty(r.Write.DeliveryPublicKey) && (!VaultKeyAlgorithms.TryParse(r.Write.DeliveryPublicKeyAlgorithm, out var algorithm) || !VaultKeyAlgorithms.IsAsymmetric(algorithm))))
        {
            return ApiError.Result(ApiErrorCode.INVALID_ALGORITHM, 400);
        }

        if (resolved.Any(r => !string.IsNullOrEmpty(r.Write.DeliveryPublicKey) && !RsaPublicKeyValidator.IsValid(r.Write.DeliveryPublicKey)))
        {
            return ApiError.Result(ApiErrorCode.INVALID_REQUEST, 400);
        }

        // A new delivery key must be signed by the caller, so a stolen access token alone cannot redirect incoming mail.
        if (!await DeliveryKeyChangesAreSignedAsync(context, user.Id, resolved, accountKeys))
        {
            return ApiError.Result(ApiErrorCode.SIGNATURE_INVALID, 400);
        }

        // The DbContext uses a retrying execution strategy (EnableRetryOnFailure), which forbids user-initiated
        // transactions unless the whole unit runs inside the strategy so it can be retried atomically.
        var strategy = context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync<IActionResult>(async () =>
        {
            await using var tx = await context.Database.BeginTransactionAsync();

            // 1) Validate every referenced hash exists in the store of the manifest that references it.
            var referencedHashes = resolved.SelectMany(r => r.Write.BlobReferences).Select(br => br.Hash).Distinct().ToList();
            var missing = new List<string>();
            if (referencedHashes.Count > 0)
            {
                var writtenManifestIds = resolved.Select(r => r.Row.ManifestId).ToList();
                var present = (await context.VaultBlobObjects
                        .Where(b => writtenManifestIds.Contains(b.ManifestId) && referencedHashes.Contains(b.Hash))
                        .Select(b => new { b.ManifestId, b.Hash })
                        .ToListAsync())
                    .Select(b => (b.ManifestId, b.Hash))
                    .ToHashSet();
                missing = resolved.SelectMany(r => r.Write.BlobReferences.Where(br => !present.Contains((r.Row.ManifestId, br.Hash))).Select(br => br.Hash)).Distinct().ToList();
            }

            if (missing.Count > 0)
            {
                await tx.RollbackAsync();
                return Ok(new VaultWriteResponse
                {
                    Status = VaultWriteStatus.Ok,
                    MissingBlobHashes = missing,
                    ManifestRevisions = resolved.Select(r => new ManifestWriteResult { ManifestId = r.Write.ManifestId, Revision = r.Row.RevisionNumber }).ToList(),
                });
            }

            // 2) Apply each manifest: archive the current revision into history, update the row in place, run the
            // personal-only side effects (email claims count + KEK/VEK key creation), and prune history per retention.
            var manifestResults = new List<ManifestWriteResult>();
            foreach (var (mw, row) in resolved)
            {
                // A manifest without content indicates a placeholder record created during registration, which we do not want to archive.
                VaultManifestsHistory? archivedRevision = null;
                if (row.HasContent)
                {
                    archivedRevision = VaultManifestsHistory.CreateFrom(row);
                    context.VaultManifestsHistory.Add(archivedRevision);
                }

                row.VaultBlob = null;
                row.StorageFormat = VaultManifestBase.ManifestStorageFormat;
                row.ManifestBlob = manifestBlobs[mw.ManifestId];
                row.ManifestCiphertextHash = mw.ManifestCiphertextHash;

                // Manifest revisions carry no data-model version, so we null it instead.
                row.Version = null;
                row.RevisionNumber = mw.CurrentRevision + 1;
                row.FileSize = FileHelper.BytesToKilobytes(row.ManifestBlob.Length);
                row.CredentialsCount = mw.CredentialsCount;
                row.Client = ClientHeader;
                row.UpdatedByUserId = user.Id;
                row.UpdatedAt = timeProvider.GetUtcNow().UtcDateTime;

                // Every manifest counts the aliases the push filed against it, shared manifests included. One
                // address may be pushed for several manifests at once, so count distinct addresses per manifest.
                if (model.EmailRouting != null)
                {
                    row.EmailClaimsCount = model.EmailRouting.EmailAddressList.Where(x => x.ManifestId == row.ManifestId).Select(x => EmailHelper.SanitizeEmail(x.Address)).Distinct().Count();
                }

                if (row.OwnerGroupId == user.PersonalGroupId)
                {
                    row.CreatedAt = timeProvider.GetUtcNow().UtcDateTime;

                    // Create the account-key hierarchy atomically with this write on the migration (first push after
                    // the client re-encrypted the vault under a fresh VEK).
                    if (accountKeys != null)
                    {
                        context.UserUnlockKeys.Add(new UserUnlockKey
                        {
                            Id = Guid.NewGuid(),
                            UserId = user.Id,
                            Type = UnlockMethodType.Password,
                            Algorithm = VaultKeyAlgorithms.Parse(accountKeys.EncryptedAccountKeyAlgorithm),
                            EncryptedAccountKey = accountKeys.EncryptedAccountKey!,
                            Metadata = new VaultKeyMetadata
                            {
                                Salt = row.Salt,
                                SrpVerifier = row.Verifier,
                                EncryptionType = row.EncryptionType,
                                EncryptionSettings = row.EncryptionSettings,
                            }.ToJson(),
                            CreatedAt = timeProvider.GetUtcNow().UtcDateTime,
                            UpdatedAt = timeProvider.GetUtcNow().UtcDateTime,
                        });

                        context.UserGrantKeys.Add(new UserGrantKey
                        {
                            Id = Guid.NewGuid(),
                            UserId = user.Id,
                            Algorithm = VaultKeyAlgorithm.RsaOaepSha256,
                            PublicKey = accountKeys.AccountPublicKey!,
                            EncryptedPrivateKey = accountKeys.EncryptedAccountPrivateKey!,
                            PublicKeySignature = accountKeys.AccountPublicKeySignature!,
                            IsPrimary = true,
                            CreatedAt = timeProvider.GetUtcNow().UtcDateTime,
                            UpdatedAt = timeProvider.GetUtcNow().UtcDateTime,
                        });

                        context.UserSigningKeys.Add(new UserSigningKey
                        {
                            Id = Guid.NewGuid(),
                            UserId = user.Id,
                            Algorithm = SigningKeyAlgorithm.Ed25519,
                            PublicKey = accountKeys.SigningPublicKey!,
                            EncryptedPrivateKey = accountKeys.EncryptedSigningPrivateKey!,
                            IsPrimary = true,
                            CreatedAt = timeProvider.GetUtcNow().UtcDateTime,
                            UpdatedAt = timeProvider.GetUtcNow().UtcDateTime,
                        });

                        context.VaultManifestAccessKeys.Add(new VaultManifestAccessKey
                        {
                            Id = Guid.NewGuid(),
                            UserId = user.Id,
                            VaultManifestId = row.ManifestId,
                            Type = ManifestKeyType.AccountKey,
                            Algorithm = VaultKeyAlgorithm.Aes256Gcm,
                            EncryptedVek = accountKeys.EncryptedVek!,
                            AccountKeyVersion = 0,
                            CreatedAt = timeProvider.GetUtcNow().UtcDateTime,
                            UpdatedAt = timeProvider.GetUtcNow().UtcDateTime,
                        });

                        row.Salt = null;
                        row.Verifier = null;
                        row.EncryptionType = null;
                        row.EncryptionSettings = null;
                    }
                }

                await ApplyVaultRetention(context, row, archivedRevision);
                manifestResults.Add(new ManifestWriteResult { ManifestId = mw.ManifestId, Revision = row.RevisionNumber });
            }

            try
            {
                await context.SaveChangesAsync();
            }
            catch (DbUpdateException) when (accountKeys != null)
            {
                // A concurrent migration push won the race since the unlock key check above.
                await tx.RollbackAsync();
                return ApiError.Result(ApiErrorCode.VAULT_KEY_ALREADY_EXISTS, 400);
            }

            // 3) Add blob references for each manifest's new revision.
            foreach (var (mw, row) in resolved)
            {
                foreach (var dto in mw.BlobReferences)
                {
                    context.VaultBlobReferences.Add(new VaultBlobReference
                    {
                        ManifestId = row.ManifestId,
                        RevisionNumber = row.RevisionNumber,
                        BlobHash = dto.Hash,
                    });
                }
            }

            // 4) Data bucket upserts (settings, etc.). Each insert adds a new revision row (history).
            var newBucketRevisions = new List<BucketRevision>();
            foreach (var bucket in model.Buckets)
            {
                if (!bucketBlobs.TryGetValue((bucket.ManifestId, bucket.Category), out var bucketBlob))
                {
                    continue;
                }

                var rev = await UpsertBucketAsync(context, bucket.ManifestId, bucket.Category, bucketBlob, bucket.CiphertextHash, bucket.CurrentRevision, bucketRows.GetValueOrDefault((bucket.ManifestId, bucket.Category)));
                newBucketRevisions.Add(new BucketRevision { ManifestId = bucket.ManifestId, Category = bucket.Category, Revision = rev });
            }

            /*
             * 6) Delivery keys. A manifest's keypair lives inside the manifest content, so its public half should only
             * change in a write that changes that content.
             */
            var publishing = resolved.Where(r => !string.IsNullOrEmpty(r.Write.DeliveryPublicKey)).ToList();
            if (publishing.Count > 0)
            {
                // Only admins are allowed to publish a new shared manifest's key.
                var sharedIds = publishing.Where(r => r.Row.OwnerGroupId != user.PersonalGroupId).Select(r => r.Row.ManifestId);
                var publishable = await GetAdminAccessSharedManifestIdsAsync(context, user.Id, sharedIds);
                foreach (var (mw, row) in publishing.Where(r => r.Row.OwnerGroupId == user.PersonalGroupId || publishable.Contains(r.Row.ManifestId)))
                {
                    await PublishManifestPublicKeyAsync(context, row.ManifestId, mw.DeliveryPublicKey!, VaultKeyAlgorithms.Parse(mw.DeliveryPublicKeyAlgorithm));
                }

                // Claim resolution below reads these rows back, so they must be visible to the query.
                await context.SaveChangesAsync();
            }

            if (model.EmailRouting is not null)
            {
                // Only update email claims when the client sends a non-empty routing object. If null has been sent by client, we
                // do not update the email claims (so to not delete any claims if they have been forgotten by the client).
                await UpdateEmailClaimsAsync(context, user, accessScope, model.EmailRouting);
            }

            await context.SaveChangesAsync();
            await tx.CommitAsync();

            return Ok(new VaultWriteResponse
            {
                Status = VaultWriteStatus.Ok,
                ManifestRevisions = manifestResults,
                BucketRevisions = newBucketRevisions,
            });
        });
    }

    /// <summary>
    /// Batch-upload encrypted blobs ahead of a manifest upload. Idempotent per blob on (manifest, hash). Clients chunk
    /// large blob sets across multiple calls to keep individual request bodies within server limits. A blob uploaded
    /// here but never referenced by a manifest is cleaned up by the task runner after its grace period.
    /// </summary>
    /// <param name="model">Blob upload request.</param>
    /// <returns>Blob upload response.</returns>
    [HttpPost("blobs")]
    public async Task<IActionResult> UploadBlobs([FromBody] BlobUploadRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        var ownerGroupId = await GetBlobManifestOwnerGroupIdAsync(context, user, model.ManifestId);
        if (ownerGroupId == null)
        {
            return ApiError.Result(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404);
        }

        // Replacing ciphertext is only part of the caller's own KEK/VEK migration, a shared manifest's key change is not implemented
        // yet. TODO: when implementing shared manifest key change, update this check too.
        if (model.Overwrite && ownerGroupId != user.PersonalGroupId)
        {
            return ApiError.Result(ApiErrorCode.INVALID_REQUEST, 400);
        }

        // Only allow overwriting the ciphertext if the user has no unlock key yet (as part of one-time legacy migration).
        if (model.Overwrite && await context.UserUnlockKeys.AnyAsync(x => x.UserId == user.Id && x.Type == UnlockMethodType.Password))
        {
            return ApiError.Result(ApiErrorCode.VAULT_KEY_ALREADY_EXISTS, 400);
        }

        if (model.Blobs.Count == 0)
        {
            return Ok(new BlobUploadResponse { AcceptedCount = 0 });
        }

        if (!await TryUpsertBlobObjectsAsync(context, model.ManifestId, model.Blobs, model.Overwrite))
        {
            return ApiError.Result(ApiErrorCode.INVALID_REQUEST, 400);
        }

        await context.SaveChangesAsync();
        return Ok(new BlobUploadResponse { AcceptedCount = model.Blobs.Count });
    }

    /// <summary>
    /// Returns the subset of the supplied hashes the server is missing for this manifest. Lets a client upload only
    /// the blob bytes the server doesn't already have. POST with a body (not GET with a query string) because a
    /// vault can reference hundreds of 64-char hashes, which would exceed URL length limits.
    /// </summary>
    /// <param name="model">Hash list request.</param>
    /// <returns>Hashes the server lacks.</returns>
    [HttpPost("blobs/missing")]
    public async Task<IActionResult> GetMissingBlobs([FromBody] BlobHashesRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        var ownerGroupId = await GetBlobManifestOwnerGroupIdAsync(context, user, model.ManifestId);
        if (ownerGroupId == null)
        {
            return ApiError.Result(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404);
        }

        var hashes = model.Hashes.Distinct().ToList();
        if (hashes.Count == 0)
        {
            return Ok(new MissingBlobsResponse());
        }

        var present = await context.VaultBlobObjects
            .Where(b => b.ManifestId == model.ManifestId && hashes.Contains(b.Hash))
            .Select(b => b.Hash)
            .ToListAsync();

        return Ok(new MissingBlobsResponse { Missing = hashes.Except(present).ToList() });
    }

    /// <summary>
    /// Download a batch of one manifest's encrypted blobs by hash, as a <see cref="BinaryFrame"/>.
    /// </summary>
    /// <param name="model">Hash list request.</param>
    /// <returns>The stored blobs among the requested hashes.</returns>
    [HttpPost("blobs/download")]
    public async Task<IActionResult> DownloadBlobs([FromBody] BlobHashesRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        var ownerGroupId = await GetBlobManifestOwnerGroupIdAsync(context, user, model.ManifestId);
        if (ownerGroupId == null)
        {
            return ApiError.Result(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404);
        }

        var wanted = model.Hashes.Distinct().ToList();
        var blobs = await context.VaultBlobObjects
            .Where(b => b.ManifestId == model.ManifestId && wanted.Contains(b.Hash))
            .Select(b => new BlobEntry { Hash = b.Hash, Category = b.Category, EncryptedBlobKey = b.EncryptedBlobKey, Data = b.EncryptedData })
            .ToListAsync();

        return File(BinaryFrame.Write(new BlobDownloadResponse { Blobs = blobs }), BinaryFrame.ContentType);
    }

    /// <summary>
    /// Moves an email alias to another manifest, which becomes its only owner. The caller must be able to open both the
    /// current owning manifest and the target.
    /// </summary>
    /// <param name="model">The alias and the target manifest.</param>
    /// <returns>Ok when the alias is owned by the target manifest.</returns>
    [HttpPost("email-claims/transfer")]
    public async Task<IActionResult> TransferEmailClaim([FromBody] EmailClaimTransferRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return ApiError.Result(ApiErrorCode.NOT_AUTHENTICATED, 401);
        }

        var accessScope = await ManifestAccessHelper.ResolveScopeAsync(context, user.Id, user.PersonalGroupId);
        var accessible = (await AccessibleManifests(context, accessScope).Select(m => m.ManifestId).ToListAsync()).ToHashSet();

        var address = EmailHelper.SanitizeEmail(model.Address);
        var claim = await context.EmailClaims.FirstOrDefaultAsync(c => c.Address == address);
        if (claim?.VaultManifestId is not Guid sourceManifestId || !accessible.Contains(sourceManifestId))
        {
            return ApiError.Result(ApiErrorCode.EMAIL_CLAIM_NOT_FOUND, 404);
        }

        if (!accessible.Contains(model.TargetManifestId))
        {
            return ApiError.Result(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404);
        }

        if (sourceManifestId == model.TargetManifestId)
        {
            return Ok();
        }

        var targetGroupId = (await GroupHelper.GetOwnerGroupsAsync(context, [model.TargetManifestId]))[model.TargetManifestId];

        var strategy = context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync<IActionResult>(async () =>
        {
            await using var tx = await context.Database.BeginTransactionAsync();

            await LockAliasQuotaGroupsAsync(context, [targetGroupId]);
            await context.Entry(claim).ReloadAsync();
            if (claim.VaultManifestId != sourceManifestId)
            {
                return ApiError.Result(ApiErrorCode.EMAIL_CLAIM_MOVED, 409);
            }

            var remaining = await GetRemainingAliasAllowancesAsync(context, user, [targetGroupId]);
            if (remaining.TryGetValue(targetGroupId, out var left) && left <= 0)
            {
                return ApiError.Result(ApiErrorCode.ALIAS_LIMIT_REACHED, 400);
            }

            // A Removed claim comes back Active: moving an alias to the item that now carries it is how it is restored.
            claim.VaultManifestId = model.TargetManifestId;
            if (claim.State == EmailClaimState.Removed)
            {
                claim.State = EmailClaimState.Active;
            }

            claim.UpdatedAt = timeProvider.GetUtcNow().UtcDateTime;
            await context.SaveChangesAsync();
            await tx.CommitAsync();

            logger.LogInformation("{User} transferred alias {Email} from manifest {Source} to manifest {Target}.", user.UserName, address, sourceManifestId, model.TargetManifestId);
            return Ok();
        });
    }

    /// <summary>
    /// Gets the manifest ids that a user has admin access to.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The calling user.</param>
    /// <param name="manifestIds">Candidate manifest ids from the request.</param>
    /// <returns>The subset of <paramref name="manifestIds"/> the user has access to and may claim new aliases for.</returns>
    private static async Task<HashSet<Guid>> GetAdminAccessSharedManifestIdsAsync(AliasServerDbContext context, string userId, IEnumerable<Guid> manifestIds)
    {
        var ids = manifestIds.Distinct().ToList();
        if (ids.Count == 0)
        {
            return [];
        }

        var grants = ManifestAccessHelper.Grants(context, userId);
        var administered = await GroupHelper.SharedManifests(context)
            .Where(m => ids.Contains(m.ManifestId)
                && context.GroupMembers.Any(gm => gm.GroupId == m.OwnerGroupId && gm.UserId == userId && (gm.Role == GroupRole.Admin || gm.Role == GroupRole.Owner))
                && grants.Any(k => k.VaultManifestId == m.ManifestId))
            .Select(m => m.ManifestId)
            .ToListAsync();

        return [.. administered];
    }

    /// <summary>
    /// Takes a transaction-scoped lock per alias quota group, so alias counting and claiming for a group run one at a time.
    /// Locks are taken in a fixed order to rule out deadlocks between callers locking several groups.
    /// </summary>
    /// <param name="context">Database context, inside an open transaction.</param>
    /// <param name="groupIds">The quota groups about to be checked and charged.</param>
    private static async Task LockAliasQuotaGroupsAsync(AliasServerDbContext context, IEnumerable<Guid> groupIds)
    {
        foreach (var groupId in groupIds.Distinct().Order())
        {
            await context.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({"alias-quota:" + groupId}, 0))");
        }
    }

    /// <summary>
    /// Gets the account public key each grant's VEK was encrypted with (see <see cref="UserGrantKey"/>).
    /// </summary>
    private static async Task<Dictionary<Guid, string>> GetAccountPublicKeysAsync(AliasServerDbContext context, IEnumerable<Guid> publicKeyIds)
    {
        var ids = publicKeyIds.Distinct().ToList();
        if (ids.Count == 0)
        {
            return new Dictionary<Guid, string>();
        }

        return await context.UserGrantKeys
            .Where(k => ids.Contains(k.Id))
            .ToDictionaryAsync(k => k.Id, k => k.PublicKey);
    }

    /// <summary>
    /// The manifests a user can access, narrowed to the manifest-v1 storage format this controller serves.
    /// Same access rule as <see cref="ManifestAccessHelper.AccessibleManifests"/>; only the format differs.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="scope">The caller's manifest access scope.</param>
    /// <returns>Query over the accessible manifest-v1 manifests.</returns>
    private static IQueryable<VaultManifest> AccessibleManifests(AliasServerDbContext context, ManifestAccessScope scope)
    {
        return ManifestAccessHelper.AccessibleManifests(context, scope).Where(m => m.StorageFormat == VaultManifestBase.ManifestStorageFormat);
    }

    /// <summary>
    /// Gets the owner group of the manifest a blob request is scoped to, when the caller can access that manifest.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="user">The calling user.</param>
    /// <param name="manifestId">The manifest named by the request.</param>
    /// <returns>The owner group id, or null when the manifest does not exist or the caller cannot access it.</returns>
    private static async Task<Guid?> GetBlobManifestOwnerGroupIdAsync(AliasServerDbContext context, AliasVaultUser user, Guid manifestId)
    {
        var accessScope = await ManifestAccessHelper.ResolveScopeAsync(context, user.Id, user.PersonalGroupId);
        return await ManifestAccessHelper.AccessibleManifests(context, accessScope).Where(x => x.ManifestId == manifestId).Select(x => (Guid?)x.OwnerGroupId).FirstOrDefaultAsync();
    }

    /// <summary>
    /// Whether every delivery key this write would make primary is signed by the caller (a key that is already primary needs no signature).
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The calling user.</param>
    /// <param name="resolved">The manifest writes with their rows.</param>
    /// <param name="accountKeys">The key hierarchy an upgrade push creates, if any.</param>
    /// <returns>True when every change is signed.</returns>
    private static async Task<bool> DeliveryKeyChangesAreSignedAsync(AliasServerDbContext context, string userId, List<(ManifestWrite Write, VaultManifest Row)> resolved, AccountKeysUpload? accountKeys)
    {
        var publishing = resolved.Where(r => !string.IsNullOrEmpty(r.Write.DeliveryPublicKey)).ToList();
        if (publishing.Count == 0)
        {
            return true;
        }

        var manifestIds = publishing.Select(r => r.Row.ManifestId).ToList();
        var primaryKeys = await context.VaultManifestDeliveryKeys.Where(k => manifestIds.Contains(k.VaultManifestId) && k.IsPrimary).ToDictionaryAsync(k => k.VaultManifestId, k => k.PublicKey);

        // The upgrade push carries the signing key it signs with; it is stored in the same write.
        var signingKey = accountKeys?.SigningPublicKey ?? await GrantHelper.GetPrimarySigningKeyAsync(context, userId);
        return publishing.All(r => primaryKeys.GetValueOrDefault(r.Row.ManifestId) == r.Write.DeliveryPublicKey
            || Signing.Verify(signingKey, Signing.DeliveryKeyMessage(r.Row.ManifestId, r.Write.DeliveryPublicKey!, r.Write.CurrentRevision), r.Write.DeliveryPublicKeySignature));
    }

    /// <summary>
    /// Gets the caller's key row on each of the given manifests, whichever way that manifest's VEK is encrypted for
    /// them: an account-key row (unlocked through their password chain) or a grant encrypted to one of their public
    /// keys. The highest key version wins; within one version an account-key row is preferred over a grant.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="userId">The calling user.</param>
    /// <param name="manifestIds">The manifests to get key rows for.</param>
    /// <returns>The key row per manifest id, empty when the caller holds none.</returns>
    private static async Task<Dictionary<Guid, VaultManifestAccessKey>> GetAccessKeysAsync(AliasServerDbContext context, string userId, IEnumerable<Guid> manifestIds)
    {
        var ids = manifestIds.Distinct().ToList();
        if (ids.Count == 0)
        {
            return [];
        }

        return (await context.VaultManifestAccessKeys
                .Where(k => k.UserId == userId && ids.Contains(k.VaultManifestId))
                .ToListAsync())
            .GroupBy(k => k.VaultManifestId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(k => k.KeyVersion).ThenBy(k => k.Type == ManifestKeyType.AccountKey ? 0 : 1).ThenByDescending(k => k.CreatedAt).ThenBy(k => k.Id).First());
    }

    /// <summary>
    /// Writes a new revision of a (manifest, bucket kind): the current row is copied to the history table and then updated in place.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="manifestId">The manifest that owns the bucket.</param>
    /// <param name="kind">The bucket category.</param>
    /// <param name="encryptedData">The new encrypted payload as raw ciphertext bytes.</param>
    /// <param name="ciphertextHash">Storage-layer integrity hash of the payload.</param>
    /// <param name="currentRevision">The revision the client believes is current, used to seed a first write.</param>
    /// <param name="existing">The current row, already loaded by the revision gate, or null when none exists yet.</param>
    /// <returns>The new revision number.</returns>
    private async Task<long> UpsertBucketAsync(AliasServerDbContext context, Guid manifestId, VaultDataBucketCategory kind, byte[] encryptedData, string? ciphertextHash, long? currentRevision, VaultDataBucket? existing)
    {
        var now = timeProvider.GetUtcNow().UtcDateTime;

        if (existing is null)
        {
            var firstRev = (currentRevision ?? 0) + 1;
            context.VaultDataBuckets.Add(new VaultDataBucket
            {
                ManifestId = manifestId,
                Category = kind,
                EncryptedData = encryptedData,
                CiphertextHash = ciphertextHash,
                RevisionNumber = firstRev,
                CreatedAt = now,
                UpdatedAt = now,
            });
            return firstRev;
        }

        // Archive the outgoing revision before overwriting it, exactly as the manifest write path does.
        var archived = VaultDataBucketsHistory.CreateFrom(existing);
        context.VaultDataBucketsHistory.Add(archived);

        var newRev = existing.RevisionNumber + 1;
        existing.EncryptedData = encryptedData;
        existing.CiphertextHash = ciphertextHash;
        existing.RevisionNumber = newRev;
        existing.UpdatedAt = now;

        await ApplyBucketRetentionAsync(context, manifestId, kind, archived);
        return newRev;
    }

    /// <summary>
    /// Prunes superseded revisions of one bucket down to <see cref="_bucketRetentionPolicy"/>.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="manifestId">The manifest that owns the bucket.</param>
    /// <param name="kind">The bucket category.</param>
    /// <param name="justArchived">The revision archived by this write, included in the retention window.</param>
    private async Task ApplyBucketRetentionAsync(AliasServerDbContext context, Guid manifestId, VaultDataBucketCategory kind, VaultDataBucketsHistory justArchived)
    {
        var history = await context.VaultDataBucketsHistory.Where(x => x.ManifestId == manifestId && x.Category == kind && x.RevisionNumber != justArchived.RevisionNumber).ToListAsync();
        history.Add(justArchived);

        var toDelete = VaultRetentionManager.ApplyRetention(_bucketRetentionPolicy, history, timeProvider.GetUtcNow().UtcDateTime);
        if (toDelete.Count > 0)
        {
            context.VaultDataBucketsHistory.RemoveRange(toDelete);
        }
    }

    /// <summary>
    /// Upserts a batch of encrypted blob objects for a manifest in one round-trip. Existing blobs (same hash) are left
    /// as they are, unless <paramref name="overwrite"/> is set (KEK/VEK migration) in which case their ciphertext is
    /// replaced with the re-encrypted bytes. The caller of this method should call SaveChanges after calling this method.
    /// </summary>
    /// <param name="context">DbContext to operate on.</param>
    /// <param name="manifestId">The manifest the blobs belong to.</param>
    /// <param name="blobs">Blobs to upsert.</param>
    /// <param name="overwrite">When true, existing blobs with the same hash get their ciphertext replaced.</param>
    /// <returns>True when every payload is structurally valid; false when any is malformed (caller should 400).</returns>
    private async Task<bool> TryUpsertBlobObjectsAsync(AliasServerDbContext context, Guid manifestId, List<BlobEntry> blobs, bool overwrite = false)
    {
        var nowUtc = timeProvider.GetUtcNow().UtcDateTime;
        var hashes = blobs.Select(b => b.Hash).Distinct().ToList();
        var existing = await context.VaultBlobObjects
            .Where(b => b.ManifestId == manifestId && hashes.Contains(b.Hash))
            .ToDictionaryAsync(b => b.Hash, StringComparer.Ordinal);

        foreach (var dto in blobs)
        {
            if ((!existing.TryGetValue(dto.Hash, out var row) || overwrite) && !CiphertextHelper.IsCiphertext(dto.Data))
            {
                return false;
            }

            if (row != null)
            {
                if (overwrite)
                {
                    row.Category = dto.Category;
                    row.EncryptedData = dto.Data;
                    row.EncryptedBlobKey = dto.EncryptedBlobKey;
                    row.SizeBytes = dto.Data.Length;
                }

                continue;
            }

            var entity = new VaultBlobObject
            {
                Hash = dto.Hash,
                ManifestId = manifestId,
                Category = dto.Category,
                EncryptedData = dto.Data,
                EncryptedBlobKey = dto.EncryptedBlobKey,
                SizeBytes = dto.Data.Length,
                CreatedAt = nowUtc,
            };
            context.VaultBlobObjects.Add(entity);
            existing[dto.Hash] = entity;
        }

        return true;
    }

    /// <summary>
    /// Applies the retention policy to the history revisions of a manifest and removes the pruned revisions and
    /// their blob references. Runs after the previous current revision has been archived (passed as
    /// <paramref name="justArchived"/>, still unsaved, null when there was nothing to archive) and the current row
    /// has been updated in place.
    /// </summary>
    private async Task ApplyVaultRetention(AliasServerDbContext context, VaultManifest currentManifest, VaultManifestsHistory? justArchived)
    {
        // Load existing history without the (potentially large) blob payload columns; the rules only need metadata.
        var historyRevisions = await context.VaultManifestsHistory
            .Where(x => x.ManifestId == currentManifest.ManifestId)
            .Select(x => new VaultManifestsHistory
            {
                ManifestId = x.ManifestId,
                VaultBlob = null,
                ManifestBlob = null,
                StorageFormat = x.StorageFormat,
                Version = x.Version,
                RevisionNumber = x.RevisionNumber,
                FileSize = x.FileSize,
                CredentialsCount = x.CredentialsCount,
                EmailClaimsCount = x.EmailClaimsCount,
                Salt = x.Salt,
                Verifier = x.Verifier,
                EncryptionType = x.EncryptionType,
                EncryptionSettings = x.EncryptionSettings,
                Client = x.Client,
                CreatedAt = x.CreatedAt,
                UpdatedAt = x.UpdatedAt,
            })
            .ToListAsync();
        if (justArchived is not null)
        {
            historyRevisions.Add(justArchived);
        }

        var revisionsToDelete = VaultRetentionManager.ApplyRetention(_manifestRetentionPolicy, historyRevisions, timeProvider.GetUtcNow().UtcDateTime, currentManifest);
        context.VaultManifestsHistory.RemoveRange(revisionsToDelete);

        // Blob references of pruned revisions are deleted explicitly (they only cascade with the whole manifest).
        var prunedRevisionNumbers = revisionsToDelete.Select(x => x.RevisionNumber).ToList();
        if (prunedRevisionNumbers.Count > 0)
        {
            await context.VaultBlobReferences.Where(r => r.ManifestId == currentManifest.ManifestId && prunedRevisionNumbers.Contains(r.RevisionNumber)).ExecuteDeleteAsync();
        }
    }

    /// <summary>
    /// Updates the email claims based on the routing data pushed by the client. Every claim has one owning manifest: a push
    /// creates claims for new addresses and updates the claims owned by the manifests it speaks for. A pair that names any
    /// other manifest for an existing address is ignored; moving an alias is an explicit transfer (see <see cref="TransferEmailClaim"/>).
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="user">The calling user.</param>
    /// <param name="scope">The caller's manifest access scope.</param>
    /// <param name="routing">The pushed routing data: one entry per (address, manifest) pair, plus the manifests it speaks for.</param>
    private async Task UpdateEmailClaimsAsync(AliasServerDbContext context, AliasVaultUser user, ManifestAccessScope scope, EmailRoutingPush routing)
    {
        // Get all unique emails with calculated state (active wins from paused in case there are multiple).
        var pushedPairs = routing.EmailAddressList
            .GroupBy(x => new { Address = EmailHelper.SanitizeEmail(x.Address), x.ManifestId })
            .Select(g => new { g.Key.Address, g.Key.ManifestId, State = g.All(x => x.Paused) ? EmailClaimState.Paused : EmailClaimState.Active })
            .ToList();

        var accessibleManifests = (await ManifestAccessHelper.AccessibleManifests(context, scope).Select(m => m.ManifestId).ToListAsync()).ToHashSet();

        // Resolved server-side and never read off the push: this is what stops a client filing an alias under a manifest it merely named.
        var personalManifestId = await GroupHelper.GetPersonalManifestIdAsync(context, user.PersonalGroupId);
        if (personalManifestId is null)
        {
            logger.LogError("No personal manifest found for {User}; skipping email claim update.", user.UserName);
            return;
        }

        var assertedPairs = new List<(string Address, Guid ManifestId, EmailClaimState State)>();
        foreach (var pair in pushedPairs)
        {
            if (!accessibleManifests.Contains(pair.ManifestId))
            {
                logger.LogWarning("{User} claimed alias {Email} for manifest {Manifest} they cannot access; dropping the pair.", user.UserName, pair.Address, pair.ManifestId);
                continue;
            }

            assertedPairs.Add((pair.Address, pair.ManifestId, pair.State));
        }

        var assertedManifestIds = assertedPairs.Select(p => p.ManifestId).Distinct().ToList();
        var ownerGroupByManifest = await GroupHelper.GetOwnerGroupsAsync(context, assertedManifestIds);

        // The manifests this push speaks for: the ones the client says it opened, plus any it named an address for.
        var coveredManifestIds = routing.CoveredManifestIds.ToHashSet();
        coveredManifestIds.UnionWith(assertedManifestIds);

        var updateScope = accessibleManifests.Intersect(coveredManifestIds).Intersect(routing.BaseRevisions.Select(r => r.ManifestId)).ToHashSet();

        // Warn when a shared manifest claims aliases without a published delivery key: it gets no wrap for its mail until one is published.
        var manifestsWithDeliveryKey = (await context.VaultManifestDeliveryKeys
            .Where(k => assertedManifestIds.Contains(k.VaultManifestId) && k.IsPrimary)
            .Select(k => k.VaultManifestId)
            .ToListAsync()).ToHashSet();
        foreach (var (address, manifestId, _) in assertedPairs.Where(p => p.State == EmailClaimState.Active && p.ManifestId != personalManifestId.Value && !manifestsWithDeliveryKey.Contains(p.ManifestId)))
        {
            logger.LogWarning("{User} claimed shared alias {Email} for manifest {Manifest} with no published delivery key; that manifest gets no wrap for its mail until a delivery key is published.", user.UserName, address, manifestId);
        }

        // Per address: the manifests that carry it, each with the state the push puts it in there.
        var desiredByAddress = assertedPairs.GroupBy(p => p.Address).ToDictionary(g => g.Key, g => g.ToDictionary(p => p.ManifestId, p => p.State));

        // The claims this push may touch: the ones owned by a manifest it speaks for, plus any existing claim on a pushed address.
        var pushedAddresses = desiredByAddress.Keys.ToList();
        var updateScopeIds = updateScope.Select(id => (Guid?)id).ToList();
        var claims = await context.EmailClaims.Where(c => updateScopeIds.Contains(c.VaultManifestId) || pushedAddresses.Contains(c.Address)).ToListAsync();
        var claimedAddresses = claims.Select(c => c.Address).ToHashSet();

        var supportedDomains = config.PrivateEmailDomains;
        var now = timeProvider.GetUtcNow().UtcDateTime;

        // Max-alias check: how many new aliases each quota subject (the group owning the manifest) may still create.
        await LockAliasQuotaGroupsAsync(context, ownerGroupByManifest.Values.Append(user.PersonalGroupId));
        var remainingAliases = await GetRemainingAliasAllowancesAsync(context, user, ownerGroupByManifest.Values);
        var limitLoggedFor = new HashSet<Guid>();

        // Check if the caller has enough quota to create a new claim for the given manifest.
        bool TryChargeQuota(Guid manifestId)
        {
            var quotaGroupId = ownerGroupByManifest.TryGetValue(manifestId, out var ownerGroupId) ? ownerGroupId : user.PersonalGroupId;
            if (!remainingAliases.TryGetValue(quotaGroupId, out var remaining))
            {
                return true;
            }

            if (remaining <= 0)
            {
                if (limitLoggedFor.Add(quotaGroupId))
                {
                    logger.LogWarning("Alias creation limit reached for group {QuotaGroup} (pushed by {User}). Skipping creation of additional aliases charged to it.", quotaGroupId, user.UserName);
                }

                return false;
            }

            remainingAliases[quotaGroupId] = remaining - 1;
            return true;
        }

        // New addresses: the first manifest to claim one owns it, preferring the caller's personal manifest when the push files it there.
        foreach (var (address, desiredManifests) in desiredByAddress.Where(d => !claimedAddresses.Contains(d.Key)))
        {
            if (!new System.ComponentModel.DataAnnotations.EmailAddressAttribute().IsValid(address))
            {
                logger.LogWarning("{User} tried to claim invalid email: {Email}", user.UserName, address);
                continue;
            }

            var domain = address.Split('@')[1];
            if (!supportedDomains.Contains(domain))
            {
                logger.LogWarning("{User} tried to claim unsupported domain: {Email}", user.UserName, address);
                continue;
            }

            var ownerManifestId = desiredManifests.ContainsKey(personalManifestId.Value) ? personalManifestId.Value : desiredManifests.Keys.First();
            if (!TryChargeQuota(ownerManifestId))
            {
                continue;
            }

            context.EmailClaims.Add(new EmailClaim
            {
                VaultManifestId = ownerManifestId,
                State = desiredManifests[ownerManifestId],
                Address = address,
                AddressLocal = address.Split('@')[0],
                AddressDomain = domain,
                CreatedAt = now,
                UpdatedAt = now,
            });
        }

        // Claims owned by a manifest this push speaks for take the state the push gives them there, or Removed when that
        // manifest no longer carries the address. A Removed claim stays owned, so only this manifest can claim it back.
        foreach (var claim in claims.Where(c => c.VaultManifestId is Guid owner && updateScope.Contains(owner)))
        {
            var state = desiredByAddress.TryGetValue(claim.Address, out var desired) && desired.TryGetValue(claim.VaultManifestId!.Value, out var pushed) ? pushed : EmailClaimState.Removed;
            if (claim.State != state)
            {
                claim.State = state;
                claim.UpdatedAt = now;
            }
        }
    }

    /// <summary>
    /// Gets how many new aliases each quota subject may still create. The subject is the group that owns the manifest
    /// the alias is filed under: the caller's personal group for personal aliases, and the owning group of each shared
    /// manifest this push adds aliases to. Both the rules (see <see cref="RateLimit"/>) and the consumption they are
    /// measured against are scoped to that group, so a shared group's aliases never drain the caller's personal
    /// allowance. When multiple limits apply to a group the strictest one wins. Groups without any configured limit
    /// are absent from the result (unlimited).
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="caller">The pushing user; their personal group is always a subject via their personal aliases.</param>
    /// <param name="sharedGroupIds">The owning group of each shared manifest in this push.</param>
    /// <returns>Remaining alias amount per quota group, for the groups that have limits at all.</returns>
    private Task<Dictionary<Guid, int>> GetRemainingAliasAllowancesAsync(AliasServerDbContext context, AliasVaultUser caller, IEnumerable<Guid> sharedGroupIds)
    {
        // The caller's personal group is always in play; the shared manifests add their owning groups on top.
        return rateLimitService.GetRemainingAliasAllowancesAsync(context, sharedGroupIds.Append(caller.PersonalGroupId));
    }

    /// <summary>
    /// Publishes <paramref name="newPublicKey"/> as the primary key of a manifest and demotes the previous one.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="vaultManifestId">
    /// The manifest this key belongs to: the caller's personal manifest for their personal key, a shared manifest
    /// for its delivery key. Everything here is scoped by it, promoting a shared manifest's key must never demote
    /// the user's personal key, and rotating the personal key must never demote a shared manifest's delivery key. The key
    /// carries no user owner at all: it must survive the publishing admin deleting their account, and a later
    /// admin republishing must land on the same scope rather than a per-user copy.
    /// </param>
    /// <param name="newPublicKey">The public key to publish.</param>
    /// <param name="algorithm">The algorithm of the public key.</param>
    private async Task PublishManifestPublicKeyAsync(AliasServerDbContext context, Guid vaultManifestId, string newPublicKey, VaultKeyAlgorithm algorithm)
    {
        var scope = context.VaultManifestDeliveryKeys.Where(x => x.VaultManifestId == vaultManifestId);

        var exists = await scope.AnyAsync(x => x.IsPrimary && x.PublicKey == newPublicKey);
        if (exists)
        {
            return;
        }

        var others = await scope.ToListAsync();
        foreach (var key in others)
        {
            key.IsPrimary = false;
            key.UpdatedAt = timeProvider.GetUtcNow().UtcDateTime;
        }

        var existingKey = others.FirstOrDefault(x => x.PublicKey == newPublicKey);
        if (existingKey != null)
        {
            existingKey.IsPrimary = true;
            existingKey.UpdatedAt = timeProvider.GetUtcNow().UtcDateTime;
            return;
        }

        context.VaultManifestDeliveryKeys.Add(new VaultManifestDeliveryKey
        {
            VaultManifestId = vaultManifestId,
            Algorithm = algorithm,
            PublicKey = newPublicKey,
            IsPrimary = true,
            CreatedAt = timeProvider.GetUtcNow().UtcDateTime,
            UpdatedAt = timeProvider.GetUtcNow().UtcDateTime,
        });
    }
}
