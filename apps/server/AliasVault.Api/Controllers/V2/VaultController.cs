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
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi;
using AliasVault.Shared.Models.WebApi.V2.Vault;
using AliasVault.Shared.Providers.Time;
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
    ITimeProvider timeProvider,
    Config config,
    RateLimitService rateLimitService) : AuthenticatedRequestController(userManager)
{
    private const string ManifestFormat = "manifest-v1";
    private const string LegacyFormat = "sqlite-blob";

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
            new LoginCredentialRetentionRule { CredentialsToKeep = 2 },
        ],
    };

    /// <summary>
    /// Atomic snapshot. Returns the latest encrypted manifest + metadata + blob refs + email routing.
    /// </summary>
    /// <returns>Snapshot DTO.</returns>
    [HttpGet("")]
    public async Task<IActionResult> Get()
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized();
        }

        var emailRouting = await BuildEmailRoutingAsync(context, user);
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

            return Ok(new GetResponse
            {
                Status = VaultStatus.Ok,
                StorageFormat = StorageFormat.SqliteBlob,
                LegacyVaultBlob = legacy?.VaultBlob ?? string.Empty,
                Version = legacy?.Version ?? string.Empty,
                LegacyRevision = legacy?.RevisionNumber ?? 0,
                PersonalManifestId = legacy?.ManifestId,
                EmailRouting = emailRouting,
            });
        }

        var manifestIds = latestManifests.Select(m => m.ManifestId).ToList();
        var buckets = await context.VaultDataBuckets
            .Where(x => manifestIds.Contains(x.ManifestId))
            .Select(x => new Bucket
            {
                ManifestId = x.ManifestId,
                Category = x.Category,
                Blob = Convert.ToBase64String(x.EncryptedData),
                CiphertextHash = x.CiphertextHash,
                Revision = x.RevisionNumber,
            })
            .ToListAsync();
        var currentRevisionByManifest = latestManifests.ToDictionary(m => m.ManifestId, m => m.RevisionNumber);
        var refsByManifest = (await context.VaultBlobReferences
                .Where(r => manifestIds.Contains(r.ManifestId))
                .Join(context.VaultBlobObjects, r => r.BlobHash, b => b.Hash, (r, b) => new { r.ManifestId, r.RevisionNumber, b.Hash, b.Category, b.SizeBytes })
                .ToListAsync())
            .Where(x => currentRevisionByManifest.TryGetValue(x.ManifestId, out var rev) && rev == x.RevisionNumber)
            .GroupBy(x => x.ManifestId)
            .ToDictionary(g => g.Key, g => g.GroupBy(x => x.Hash, StringComparer.Ordinal).Select(h => new BlobReference { Hash = h.Key, Category = h.First().Category, SizeBytes = h.First().SizeBytes }).ToList());

        var accessKeysByManifest = await GetAccessKeysAsync(context, user.Id, manifestIds);
        var encryptionPublicKeys = await GetEncryptionPublicKeysAsync(context, accessKeysByManifest.Values.Where(g => g.UserGrantKeyId != null).Select(g => g.UserGrantKeyId!.Value));
        var administeredGroupIds = await GroupHelper.GetAdministeredGroupIdsAsync(context, user.Id);

        var manifests = latestManifests.Select(m =>
        {
            accessKeysByManifest.TryGetValue(m.ManifestId, out var accessKey);

            // An account-key row's ciphertext is not sent: the caller decrypted that VEK from their password chain before this call.
            var grant = accessKey != null && ManifestKeyTypes.VekTravelsWithManifest(accessKey.Type) ? accessKey : null;
            return new Manifest
            {
                ManifestId = m.ManifestId,
                Blob = m.ManifestBlob != null ? Convert.ToBase64String(m.ManifestBlob) : null,
                CiphertextHash = m.ManifestCiphertextHash,
                Revision = m.RevisionNumber,
                BlobReferences = refsByManifest.TryGetValue(m.ManifestId, out var refs) ? refs : [],
                CanAdminister = m.OwnerGroupType == GroupType.Shared && administeredGroupIds.Contains(m.OwnerGroupId) && grant != null,
                KeyType = accessKey != null ? ManifestKeyTypes.ToToken(accessKey.Type) : null,
                EncryptedVek = grant?.EncryptedVek,
                Algorithm = grant != null ? VaultKeyAlgorithms.ToToken(grant.Algorithm) : null,
                EncryptionPublicKey = grant?.UserGrantKeyId != null ? encryptionPublicKeys.GetValueOrDefault(grant.UserGrantKeyId.Value) : null,
            };
        }).ToList();

        return Ok(new GetResponse
        {
            Status = VaultStatus.Ok,
            StorageFormat = StorageFormat.Manifest,
            Manifests = manifests,
            PersonalManifestId = latestManifests.First(m => m.OwnerGroupId == user.PersonalGroupId).ManifestId,
            Buckets = buckets,
            EmailRouting = emailRouting,
        });
    }

    /// <summary>
    /// Single-manifest fetch. Returns the latest revision of one logical manifest (by ManifestId)
    /// plus its blob references, without the rest of the snapshot.
    /// </summary>
    /// <param name="manifestId">The stable identifier of the logical manifest to fetch.</param>
    /// <returns>The manifest DTO, or 404 when the user has no such manifest-v1 manifest.</returns>
    [HttpGet("manifest/{manifestId:guid}")]
    public async Task<IActionResult> GetManifest(Guid manifestId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized();
        }

        // The caller can fetch a manifest owned by a group they own, or one granted to them (a shared manifest).
        var accessScope = await ManifestAccessHelper.ResolveScopeAsync(context, user.Id, user.PersonalGroupId);
        var latest = await AccessibleManifests(context, accessScope).FirstOrDefaultAsync(x => x.ManifestId == manifestId);

        if (latest == null)
        {
            return NotFound();
        }

        var blobRefs = (await context.VaultBlobReferences
                .Where(r => r.ManifestId == latest.ManifestId && r.RevisionNumber == latest.RevisionNumber)
                .Join(context.VaultBlobObjects, r => r.BlobHash, b => b.Hash, (r, b) => new { b.Hash, b.Category, b.SizeBytes })
                .Distinct()
                .ToListAsync())
            .Select(x => new BlobReference { Hash = x.Hash, Category = x.Category, SizeBytes = x.SizeBytes })
            .ToList();

        var manifest = new Manifest
        {
            ManifestId = latest.ManifestId,
            Blob = latest.ManifestBlob != null ? Convert.ToBase64String(latest.ManifestBlob) : null,
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
            if (accessKey.UserGrantKeyId != null)
            {
                manifest.EncryptionPublicKey = await context.UserGrantKeys.Where(k => k.Id == accessKey.UserGrantKeyId).Select(k => k.PublicKey).FirstOrDefaultAsync();
            }
        }

        // Administer rights are only meaningful on a manifest that is not the caller's own home one.
        if (latest.OwnerGroupId != user.PersonalGroupId)
        {
            manifest.CanAdminister = await GroupHelper.IsGroupAdminAsync(context, latest.OwnerGroupId, user.Id);
        }

        return Ok(manifest);
    }

    /// <summary>
    /// Unified atomic write. Applies any number of changed manifests (the personal manifest and/or shared manifests), changed data
    /// buckets, and new blobs in a single all-or-nothing DB transaction.
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
            return Unauthorized();
        }

        if (!string.Equals(user.UserName, model.Username, StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.USERNAME_MISMATCH, 400));
        }

        // Each manifest and each (manifest, bucket kind) may appear at most once.
        if (model.Manifests.Select(m => m.ManifestId).Distinct().Count() != model.Manifests.Count
            || model.Buckets.Select(b => (b.ManifestId, b.Category)).Distinct().Count() != model.Buckets.Count)
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_NOT_UP_TO_DATE, 400));
        }

        // Decode base64-encoded ciphertexts into raw bytes.
        var manifestBlobs = new Dictionary<Guid, byte[]>();
        foreach (var mw in model.Manifests)
        {
            if (!CiphertextHelper.TryDecode(mw.ManifestBlob, out var manifestBlob))
            {
                return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_ERROR, 400));
            }

            manifestBlobs[mw.ManifestId] = manifestBlob;
        }

        var bucketBlobs = new Dictionary<(Guid ManifestId, VaultDataBucketCategory Category), byte[]>();
        foreach (var bucket in model.Buckets.Where(b => !string.IsNullOrEmpty(b.Blob)))
        {
            if (!CiphertextHelper.TryDecode(bucket.Blob, out var bucketBlob))
            {
                return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_ERROR, 400));
            }

            bucketBlobs[(bucket.ManifestId, bucket.Category)] = bucketBlob;
        }

        var accessScope = await ManifestAccessHelper.ResolveScopeAsync(context, user.Id, user.PersonalGroupId);

        var resolved = new List<(ManifestWrite Write, VaultManifest Row)>();
        foreach (var mw in model.Manifests)
        {
            var row = await ManifestAccessHelper.AccessibleManifests(context, accessScope).FirstOrDefaultAsync(x => x.ManifestId == mw.ManifestId);
            if (row == null)
            {
                return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404));
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
                return NotFound(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.SHARED_MANIFEST_NOT_FOUND, 404));
            }
        }

        // The caller's own manifest is the one owned by their personal group; a personal group owns no other.
        var personalWrite = resolved.FirstOrDefault(r => r.Row.OwnerGroupId == user.PersonalGroupId).Write;

        /*
         * Account-key migration: when writing the personal manifest the first time, the client needs to generate a VEK,
         * encrypt it with the AccountKey, and store it in the personal manifest. AccountKeys blobs (KEK-encrypted AK + AK-encrypted account keypair).
         * A shared-manifest write must never carry one. We reject rather than silently ignore, so a misdirected key can never be dropped unnoticed.
         * TODO: these guards can be removed once all users have migrated and we don't support legacy users anymore.
         */
        if (resolved.Any(r => r.Row.OwnerGroupId != user.PersonalGroupId && !string.IsNullOrEmpty(r.Write.EncryptedVek)))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_KEY_NOT_FOUND, 400));
        }

        var migrationEncryptedVek = personalWrite?.EncryptedVek;
        var hasExistingUnlockKey = await context.UserUnlockKeys.AnyAsync(x => x.UserId == user.Id && x.Type == UnlockMethodType.Password);
        if (!string.IsNullOrEmpty(migrationEncryptedVek) && hasExistingUnlockKey)
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_KEY_ALREADY_EXISTS, 400));
        }

        // A personal-manifest push from a not-yet-migrated user must carry the encrypted VEK to migrate the vault into the manifest-v1 format.
        if (personalWrite != null && string.IsNullOrEmpty(migrationEncryptedVek) && !hasExistingUnlockKey)
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_KEY_NOT_FOUND, 400));
        }

        // The migration VEK and the account-key blobs only make sense together: the VEK is encrypted under the AK.
        var accountKeys = model.AccountKeys;
        var accountKeysComplete = accountKeys != null && !string.IsNullOrEmpty(accountKeys.EncryptedAccountKey) && !string.IsNullOrEmpty(accountKeys.AccountPublicKey) && !string.IsNullOrEmpty(accountKeys.EncryptedAccountPrivateKey);
        if (!string.IsNullOrEmpty(migrationEncryptedVek) && !accountKeysComplete)
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_KEY_NOT_FOUND, 400));
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
        if (manifestStale || bucketStale)
        {
            return Ok(new VaultWriteResponse
            {
                Status = VaultStatus.Outdated,
                ManifestRevisions = resolved.Select(r => new ManifestWriteResult { ManifestId = r.Write.ManifestId, Revision = r.Row.RevisionNumber }).ToList(),
                BucketRevisions = model.Buckets.Select(b => new BucketRevision { ManifestId = b.ManifestId, Category = b.Category, Revision = bucketCurrentRevisions[(b.ManifestId, b.Category)] }).ToList(),
            });
        }

        // The DbContext uses a retrying execution strategy (EnableRetryOnFailure), which forbids user-initiated
        // transactions unless the whole unit runs inside the strategy so it can be retried atomically.
        var strategy = context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync<IActionResult>(async () =>
        {
            await using var tx = await context.Database.BeginTransactionAsync();

            // 1) Upsert any new blob objects.
            if (model.NewBlobs.Count > 0)
            {
                if (!await TryUpsertBlobObjectsAsync(context, user.Id, model.NewBlobs, overwrite: !string.IsNullOrEmpty(migrationEncryptedVek)))
                {
                    await tx.RollbackAsync();
                    return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_NOT_UP_TO_DATE, 400));
                }

                await context.SaveChangesAsync();
            }

            // 2) Validate every referenced hash exists.
            var ownScopeHashes = resolved.Where(r => r.Row.OwnerGroupId == user.PersonalGroupId).SelectMany(r => r.Write.BlobReferences).Select(br => br.Hash).Distinct().ToList();
            var anyScopeHashes = resolved.Where(r => r.Row.OwnerGroupId != user.PersonalGroupId).SelectMany(r => r.Write.BlobReferences).Select(br => br.Hash).Distinct().ToList();
            var missing = new List<string>();
            if (ownScopeHashes.Count > 0)
            {
                var present = await context.VaultBlobObjects.Where(b => b.OwnerUserId == user.Id && ownScopeHashes.Contains(b.Hash)).Select(b => b.Hash).ToListAsync();
                missing.AddRange(ownScopeHashes.Except(present));
            }

            if (anyScopeHashes.Count > 0)
            {
                var present = await context.VaultBlobObjects.Where(b => anyScopeHashes.Contains(b.Hash)).Select(b => b.Hash).Distinct().ToListAsync();
                missing.AddRange(anyScopeHashes.Except(present));
            }

            missing = missing.Distinct().ToList();
            if (missing.Count > 0)
            {
                await tx.RollbackAsync();
                return Ok(new VaultWriteResponse
                {
                    Status = VaultStatus.Ok,
                    MissingBlobHashes = missing,
                    ManifestRevisions = resolved.Select(r => new ManifestWriteResult { ManifestId = r.Write.ManifestId, Revision = r.Row.RevisionNumber }).ToList(),
                });
            }

            // 3) Apply each manifest: archive the current revision into history, update the row in place, run the
            // personal-only side effects (email claims count + KEK/VEK key creation), and prune history per retention.
            var manifestResults = new List<ManifestWriteResult>();
            foreach (var (mw, row) in resolved)
            {
                var archivedRevision = VaultManifestsHistory.CreateFrom(row);
                context.VaultManifestsHistory.Add(archivedRevision);

                row.VaultBlob = null;
                row.StorageFormat = ManifestFormat;
                row.ManifestBlob = manifestBlobs[mw.ManifestId];
                row.ManifestCiphertextHash = mw.ManifestCiphertextHash;

                // Manifest revisions carry no data-model version, so we null it instead.
                row.Version = null;
                row.RevisionNumber = mw.CurrentRevision + 1;
                row.FileSize = FileHelper.BytesToKilobytes(row.ManifestBlob.Length);
                row.CredentialsCount = mw.CredentialsCount;
                row.Client = ClientHeader;
                row.UpdatedAt = timeProvider.UtcNow;

                // Every manifest counts the aliases the push filed against it, shared manifests included. One
                // address may be pushed for several manifests at once, so count distinct addresses per manifest.
                if (model.EmailRouting != null)
                {
                    row.EmailClaimsCount = model.EmailRouting.EmailAddressList.Where(x => x.ManifestId == row.ManifestId).Select(x => EmailHelper.SanitizeEmail(x.Address)).Distinct().Count();
                }

                if (row.OwnerGroupId == user.PersonalGroupId)
                {
                    row.CreatedAt = timeProvider.UtcNow;

                    // Create the account-key hierarchy atomically with this write on the migration (first push after
                    // the client re-encrypted the vault under a fresh VEK). Move the SRP credentials off the manifest row.
                    if (!string.IsNullOrEmpty(migrationEncryptedVek))
                    {
                        context.UserUnlockKeys.Add(new UserUnlockKey
                        {
                            Id = Guid.NewGuid(),
                            UserId = user.Id,
                            Type = UnlockMethodType.Password,
                            Algorithm = VaultKeyAlgorithm.Aes256Gcm,
                            EncryptedAccountKey = accountKeys!.EncryptedAccountKey!,
                            Metadata = new VaultKeyMetadata
                            {
                                Salt = row.Salt,
                                SrpVerifier = row.Verifier,
                                EncryptionType = row.EncryptionType,
                                EncryptionSettings = row.EncryptionSettings,
                            }.ToJson(),
                            CreatedAt = timeProvider.UtcNow,
                            UpdatedAt = timeProvider.UtcNow,
                        });

                        context.UserGrantKeys.Add(new UserGrantKey
                        {
                            Id = Guid.NewGuid(),
                            UserId = user.Id,
                            Algorithm = VaultKeyAlgorithm.RsaOaepSha256,
                            PublicKey = accountKeys.AccountPublicKey!,
                            EncryptedPrivateKey = accountKeys.EncryptedAccountPrivateKey!,
                            IsPrimary = true,
                            CreatedAt = timeProvider.UtcNow,
                            UpdatedAt = timeProvider.UtcNow,
                        });

                        context.VaultManifestAccessKeys.Add(new VaultManifestAccessKey
                        {
                            Id = Guid.NewGuid(),
                            UserId = user.Id,
                            VaultManifestId = row.ManifestId,
                            Type = ManifestKeyType.AccountKey,
                            Algorithm = VaultKeyAlgorithm.Aes256Gcm,
                            EncryptedVek = migrationEncryptedVek,
                            AccountKeyVersion = 0,
                            CreatedAt = timeProvider.UtcNow,
                            UpdatedAt = timeProvider.UtcNow,
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

            await context.SaveChangesAsync();

            // 4) Add blob references for each manifest's new revision.
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

            // 5) Data bucket upserts (settings, etc.). Each insert adds a new revision row (history).
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
            var publishing = resolved.Where(r => !string.IsNullOrEmpty(r.Write.EncryptionPublicKey)).ToList();
            if (publishing.Count > 0)
            {
                // Only admins are allowed to publish a new shared manifest's key.
                var sharedIds = publishing.Where(r => r.Row.OwnerGroupId != user.PersonalGroupId).Select(r => r.Row.ManifestId);
                var publishable = await GetAdminAccessSharedManifestIdsAsync(context, user.Id, sharedIds);
                foreach (var (mw, row) in publishing.Where(r => r.Row.OwnerGroupId == user.PersonalGroupId || publishable.Contains(r.Row.ManifestId)))
                {
                    await PublishManifestPublicKeyAsync(context, row.ManifestId, mw.EncryptionPublicKey!);
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
                Status = VaultStatus.Ok,
                ManifestRevisions = manifestResults,
                BucketRevisions = newBucketRevisions,
            });
        });
    }

    /// <summary>
    /// Batch-upload encrypted blobs ahead of a manifest upload. Idempotent per blob on (hash, user): re-uploading
    /// an existing blob only bumps its LastReferencedAt so the GC grace period restarts. Clients chunk large blob
    /// sets across multiple calls to keep individual request bodies within server limits. A blob uploaded here but
    /// never referenced by a manifest is swept by the GC after its grace period.
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
            return Unauthorized();
        }

        if (model.Blobs.Count == 0)
        {
            return Ok(new BlobUploadResponse { AcceptedCount = 0 });
        }

        if (!await TryUpsertBlobObjectsAsync(context, user.Id, model.Blobs, model.Overwrite))
        {
            return BadRequest(ApiErrorCodeHelper.CreateValidationErrorResponse(ApiErrorCode.VAULT_NOT_UP_TO_DATE, 400));
        }

        await context.SaveChangesAsync();
        return Ok(new BlobUploadResponse { AcceptedCount = model.Blobs.Count });
    }

    /// <summary>
    /// Returns the subset of the supplied hashes the server is missing for this user. Lets a client upload only
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
            return Unauthorized();
        }

        var hashes = model.Hashes.Distinct().ToList();
        if (hashes.Count == 0)
        {
            return Ok(new MissingBlobsResponse());
        }

        var present = await context.VaultBlobObjects
            .Where(b => b.OwnerUserId == user.Id && hashes.Contains(b.Hash))
            .Select(b => b.Hash)
            .ToListAsync();

        return Ok(new MissingBlobsResponse { Missing = hashes.Except(present).ToList() });
    }

    /// <summary>
    /// Download a batch of encrypted blobs by hash. TODO: Returns base64-encoded payloads in JSON
    /// because for now we kept the codec language-agnostic. Look into switching to multipart binary in the future.
    /// </summary>
    /// <param name="model">Hash list request.</param>
    /// <returns>List of blob DTOs.</returns>
    [HttpPost("blobs/download")]
    public async Task<IActionResult> DownloadBlobs([FromBody] BlobHashesRequest model)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized();
        }

        var wanted = model.Hashes.Distinct().ToList();
        if (wanted.Count == 0)
        {
            return Ok(Array.Empty<Blob>());
        }

        var rows = await context.VaultBlobObjects
            .Where(b => b.OwnerUserId == user.Id && wanted.Contains(b.Hash))
            .Select(b => new Blob
            {
                Hash = b.Hash,
                Category = b.Category,
                EncryptedDataBase64 = Convert.ToBase64String(b.EncryptedData),
            })
            .ToListAsync();

        // Hashes not in the caller's own store may belong to a shared manifest: any blob referenced by the current
        // revision of a manifest the caller can access (granted to them, or a manifest they own that another member
        // pushed blobs for) is downloadable regardless of which member's store holds the ciphertext.
        var missing = wanted.Except(rows.Select(r => r.Hash), StringComparer.Ordinal).ToList();
        if (missing.Count > 0)
        {
            var accessScope = await ManifestAccessHelper.ResolveScopeAsync(context, user.Id, user.PersonalGroupId);
            var accessibleManifests = await AccessibleManifests(context, accessScope)
                .Where(m => m.OwnerGroup.Type == GroupType.Shared)
                .Select(m => new { m.ManifestId, m.RevisionNumber })
                .ToListAsync();
            var accessibleIds = accessibleManifests.Select(m => m.ManifestId).ToList();
            var currentRevisionById = accessibleManifests.ToDictionary(m => m.ManifestId, m => m.RevisionNumber);

            if (accessibleIds.Count > 0)
            {
                var referencedHashes = (await context.VaultBlobReferences
                        .Where(r => accessibleIds.Contains(r.ManifestId) && missing.Contains(r.BlobHash))
                        .Select(r => new { r.ManifestId, r.RevisionNumber, r.BlobHash })
                        .ToListAsync())
                    .Where(r => currentRevisionById.TryGetValue(r.ManifestId, out var rev) && rev == r.RevisionNumber)
                    .Select(r => r.BlobHash)
                    .Distinct()
                    .ToList();

                if (referencedHashes.Count > 0)
                {
                    var sharedRows = await context.VaultBlobObjects
                        .Where(b => referencedHashes.Contains(b.Hash))
                        .Select(b => new Blob
                        {
                            Hash = b.Hash,
                            Category = b.Category,
                            EncryptedDataBase64 = Convert.ToBase64String(b.EncryptedData),
                        })
                        .ToListAsync();
                    rows.AddRange(sharedRows.GroupBy(b => b.Hash, StringComparer.Ordinal).Select(g => g.First()));
                }
            }
        }

        return Ok(rows);
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

        var administered = await GroupHelper.SharedManifests(context)
            .Where(m => ids.Contains(m.ManifestId)
                && context.GroupMembers.Any(gm => gm.GroupId == m.OwnerGroupId && gm.UserId == userId && (gm.Role == GroupRole.Admin || gm.Role == GroupRole.Owner))
                && context.VaultManifestAccessKeys.Any(k => k.VaultManifestId == m.ManifestId && k.UserId == userId && k.Type == ManifestKeyType.GrantKey))
            .Select(m => m.ManifestId)
            .ToListAsync();

        return [.. administered];
    }

    /// <summary>
    /// Gets the account public key each grant's VEK was encrypted with (see <see cref="UserGrantKey"/>).
    /// </summary>
    private static async Task<Dictionary<Guid, string>> GetEncryptionPublicKeysAsync(AliasServerDbContext context, IEnumerable<Guid> publicKeyIds)
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
        return ManifestAccessHelper.AccessibleManifests(context, scope).Where(m => m.StorageFormat == ManifestFormat);
    }

    /// <summary>
    /// Gets the caller's key row on each of the given manifests, whichever way that manifest's VEK is encrypted for
    /// them: an account-key row (unlocked through their password chain) or a grant encrypted to one of their public
    /// keys. An account-key row wins when a manifest has both, being the caller's own direct path to it.
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
        var now = timeProvider.UtcNow;

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

        var toDelete = VaultRetentionManager.ApplyRetention(_bucketRetentionPolicy, history, timeProvider.UtcNow);
        if (toDelete.Count > 0)
        {
            context.VaultDataBucketsHistory.RemoveRange(toDelete);
        }
    }

    /// <summary>
    /// Upserts a batch of encrypted blob objects for a user in one round-trip. Existing blobs (same hash) only get
    /// their LastReferencedAt bumped, unless <paramref name="overwrite"/> is set (KEK/VEK migration) in which case
    /// their ciphertext is replaced with the re-encrypted bytes. The caller of this method should call SaveChanges after calling this method.
    /// </summary>
    /// <param name="context">DbContext to operate on.</param>
    /// <param name="userId">Owning user id.</param>
    /// <param name="blobs">Blobs to upsert.</param>
    /// <param name="overwrite">When true, existing blobs with the same hash get their ciphertext replaced.</param>
    /// <returns>True when every payload is structurally valid; false when any is malformed (caller should 400).</returns>
    private async Task<bool> TryUpsertBlobObjectsAsync(AliasServerDbContext context, string userId, List<Blob> blobs, bool overwrite = false)
    {
        var nowUtc = timeProvider.UtcNow;
        var hashes = blobs.Select(b => b.Hash).Distinct().ToList();
        var existing = await context.VaultBlobObjects
            .Where(b => b.OwnerUserId == userId && hashes.Contains(b.Hash))
            .ToDictionaryAsync(b => b.Hash, StringComparer.Ordinal);

        foreach (var dto in blobs)
        {
            byte[]? data = null;
            if (!existing.TryGetValue(dto.Hash, out var row) || overwrite)
            {
                if (!CiphertextHelper.TryDecode(dto.EncryptedDataBase64, out data))
                {
                    return false;
                }
            }

            if (row != null)
            {
                // Already have it (or a duplicate within this batch), bump LastReferencedAt so garbage collector leaves it alone.
                // During a KEK/VEK migration the stored ciphertext is replaced (same plaintext hash, new key).
                row.LastReferencedAt = nowUtc;
                if (overwrite)
                {
                    row.Category = dto.Category;
                    row.EncryptedData = data!;
                    row.SizeBytes = data!.Length;
                }

                continue;
            }

            var entity = new VaultBlobObject
            {
                Hash = dto.Hash,
                OwnerUserId = userId,
                Category = dto.Category,
                EncryptedData = data!,
                SizeBytes = data!.Length,
                CreatedAt = nowUtc,
                LastReferencedAt = nowUtc,
            };
            context.VaultBlobObjects.Add(entity);
            existing[dto.Hash] = entity;
        }

        return true;
    }

    /// <summary>
    /// Builds the email routing DTO for a user.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="user">The user.</param>
    /// <returns>The email routing DTO.</returns>
    private async Task<EmailRouting> BuildEmailRoutingAsync(AliasServerDbContext context, AliasVaultUser user)
    {
        var claims = await context.EmailClaims
            .Where(c => c.Links.Any(l => l.State != EmailClaimLinkState.Removed
                && context.GroupMembers.Any(gm => gm.GroupId == l.VaultManifest.OwnerGroupId && gm.UserId == user.Id && gm.Role == GroupRole.Owner)))
            .Select(c => c.Address)
            .ToListAsync();

        return new EmailRouting
        {
            EmailAddressList = claims,
            PrivateEmailDomainList = config.PrivateEmailDomains,
            HiddenPrivateEmailDomainList = config.HiddenPrivateEmailDomains,
            PublicEmailDomainList = new List<string>
            {
                "spamok.com", "solarflarecorp.com", "spamok.nl", "3060.nl", "landmail.nl",
                "asdasd.nl", "spamok.de", "spamok.com.ua", "spamok.es", "spamok.fr",
            },
        };
    }

    /// <summary>
    /// Applies the retention policy to the history revisions of a manifest and removes the pruned revisions and
    /// their blob references. Runs after the previous current revision has been archived (passed as
    /// <paramref name="justArchived"/>, still unsaved) and the current row has been updated in place.
    /// </summary>
    private async Task ApplyVaultRetention(AliasServerDbContext context, VaultManifest currentManifest, VaultManifestsHistory justArchived)
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
        historyRevisions.Add(justArchived);

        var revisionsToDelete = VaultRetentionManager.ApplyRetention(_manifestRetentionPolicy, historyRevisions, timeProvider.UtcNow, currentManifest);
        context.VaultManifestsHistory.RemoveRange(revisionsToDelete);

        // Blob references of pruned revisions are deleted explicitly (they only cascade with the whole manifest).
        var prunedRevisionNumbers = revisionsToDelete.Select(x => x.RevisionNumber).ToList();
        if (prunedRevisionNumbers.Count > 0)
        {
            await context.VaultBlobReferences.Where(r => r.ManifestId == currentManifest.ManifestId && prunedRevisionNumbers.Contains(r.RevisionNumber)).ExecuteDeleteAsync();
        }
    }

    /// <summary>
    /// Updates the email claims based on the routing data pushed by the client.
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
            .Select(g => new { g.Key.Address, g.Key.ManifestId, State = g.All(x => x.Paused) ? EmailClaimLinkState.Paused : EmailClaimLinkState.Active })
            .ToList();

        var accessibleManifests = (await ManifestAccessHelper.AccessibleManifests(context, scope).Select(m => m.ManifestId).ToListAsync()).ToHashSet();
        var ownedManifests = (await context.VaultManifests
            .Where(m => context.GroupMembers.Any(gm => gm.GroupId == m.OwnerGroupId && gm.UserId == user.Id && gm.Role == GroupRole.Owner))
            .Select(m => m.ManifestId)
            .ToListAsync()).ToHashSet();

        // Resolved server-side and never read off the push: this is what stops a client filing an alias under a manifest it merely named.
        var personalManifestId = await GroupHelper.GetPersonalManifestIdAsync(context, user.PersonalGroupId);
        if (personalManifestId is null)
        {
            logger.LogError("No personal manifest found for {User}; skipping email claim update.", user.UserName);
            return;
        }

        var assertedPairs = new List<(string Address, Guid ManifestId, EmailClaimLinkState State)>();
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

        var updateScope = accessibleManifests.Union(ownedManifests).Intersect(coveredManifestIds).ToHashSet();

        // Warn when a shared manifest claims aliases without a published delivery key: it gets no wrap for its mail until one is published.
        var manifestsWithDeliveryKey = (await context.VaultManifestDeliveryKeys
            .Where(k => assertedManifestIds.Contains(k.VaultManifestId) && k.IsPrimary)
            .Select(k => k.VaultManifestId)
            .ToListAsync()).ToHashSet();
        foreach (var (address, manifestId, _) in assertedPairs.Where(p => p.State == EmailClaimLinkState.Active && p.ManifestId != personalManifestId.Value && !manifestsWithDeliveryKey.Contains(p.ManifestId)))
        {
            logger.LogWarning("{User} claimed shared alias {Email} for manifest {Manifest} with no published delivery key; that manifest gets no wrap for its mail until a delivery key is published.", user.UserName, address, manifestId);
        }

        // Per address: the manifests that carry it, each with the state the push puts that link in.
        var desiredByAddress = assertedPairs.GroupBy(p => p.Address).ToDictionary(g => g.Key, g => g.ToDictionary(p => p.ManifestId, p => p.State));

        // Get the claims this push may update.
        var scopedEmailClaims = await context.EmailClaims
            .Include(c => c.Links)
            .Where(c => c.Links.Any(l => updateScope.Contains(l.VaultManifestId)))
            .ToListAsync();
        var userOwnedEmailClaims = scopedEmailClaims
            .Where(c => c.Links.Any(l => updateScope.Contains(l.VaultManifestId) && l.State != EmailClaimLinkState.Removed) || c.Links.All(l => l.State == EmailClaimLinkState.Removed))
            .ToList();
        var processed = new HashSet<string>();
        var supportedDomains = config.PrivateEmailDomains;

        // Max-alias check: how many new aliases each quota subject (the group owning the linked manifest) may still create.
        var remainingAliases = await GetRemainingAliasAllowancesAsync(context, user, ownerGroupByManifest.Values);
        var limitLoggedFor = new HashSet<Guid>();

        // Check if the caller has enough quota to create a new link for the given manifest.
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

        foreach (var sanitized in pushedPairs.Select(p => p.Address).Distinct())
        {
            processed.Add(sanitized);

            if (!new System.ComponentModel.DataAnnotations.EmailAddressAttribute().IsValid(sanitized))
            {
                logger.LogWarning("{User} tried to claim invalid email: {Email}", user.UserName, sanitized);
                continue;
            }

            var domain = sanitized.Split('@')[1];
            if (!supportedDomains.Contains(domain))
            {
                logger.LogWarning("{User} tried to claim unsupported domain: {Email}", user.UserName, sanitized);
                continue;
            }

            // Every pair for this address named a manifest the caller cannot access: nothing is asserted. The
            // address still counts as pushed, so the absence handling below leaves its claim alone.
            if (!desiredByAddress.TryGetValue(sanitized, out var desiredManifests) || desiredManifests.Count == 0)
            {
                continue;
            }

            var existing = userOwnedEmailClaims.FirstOrDefault(x => x.Address == sanitized);
            if (existing != null)
            {
                var changed = false;
                foreach (var (manifestId, state) in desiredManifests)
                {
                    var link = existing.Links.FirstOrDefault(l => l.VaultManifestId == manifestId);
                    if (link is null)
                    {
                        if (TryChargeQuota(manifestId))
                        {
                            existing.Links.Add(new EmailClaimLink { EmailClaimId = existing.Id, VaultManifestId = manifestId, State = state });
                            changed = true;
                        }

                        continue;
                    }

                    if (link.State != state)
                    {
                        link.State = state;
                        changed = true;
                    }
                }

                // Links in the caller's update scope that this push no longer carries: those manifests dropped the alias.
                var inScopeLinks = existing.Links.Where(l => l.State != EmailClaimLinkState.Removed && updateScope.Contains(l.VaultManifestId));
                var droppedLinks = inScopeLinks.Where(l => !desiredManifests.ContainsKey(l.VaultManifestId)).ToList();
                if (droppedLinks.Count > 0 && existing.Links.All(l => l.State == EmailClaimLinkState.Removed || droppedLinks.Contains(l)))
                {
                    // The push carries this address, yet every link would end up removed: the links it named were all
                    // blocked (e.g. by quota). Keep the previous ones rather than disable an alias the vault still has.
                    logger.LogWarning("{User} pushed {Email} but none of its links could be created; keeping its previous links.", user.UserName, sanitized);
                    droppedLinks.Clear();
                }

                foreach (var dropped in droppedLinks)
                {
                    dropped.State = EmailClaimLinkState.Removed;
                    changed = true;
                }

                if (changed)
                {
                    existing.UpdatedAt = timeProvider.UtcNow;
                }

                continue;
            }

            // Adding a link to an existing address requires access to one of its current links' manifests.
            if (await context.EmailClaims.AnyAsync(x => x.Address == sanitized))
            {
                logger.LogWarning("{User} tried to claim email already owned by another user: {Email}", user.UserName, sanitized);
                continue;
            }

            var newLinks = new List<EmailClaimLink>();
            foreach (var (manifestId, state) in desiredManifests)
            {
                if (TryChargeQuota(manifestId))
                {
                    newLinks.Add(new EmailClaimLink { VaultManifestId = manifestId, State = state });
                }
            }

            if (newLinks.Count == 0)
            {
                continue;
            }

            context.EmailClaims.Add(new EmailClaim
            {
                Links = newLinks,
                Address = sanitized,
                AddressLocal = sanitized.Split('@')[0],
                AddressDomain = sanitized.Split('@')[1],
                CreatedAt = timeProvider.UtcNow,
                UpdatedAt = timeProvider.UtcNow,
            });
        }

        // An address that is no longer pushed is dropped by every manifest in the caller's update scope: their links go to
        // removed, and once that leaves no manifest carrying the address the claim reads as dead. The rows stay behind
        // as the ownership record, which is what lets the same manifests claim the address back later.
        foreach (var claim in userOwnedEmailClaims.Where(x => !processed.Contains(x.Address)))
        {
            var droppedLinks = claim.Links.Where(l => l.State != EmailClaimLinkState.Removed && updateScope.Contains(l.VaultManifestId)).ToList();
            if (droppedLinks.Count == 0)
            {
                continue;
            }

            foreach (var link in droppedLinks)
            {
                link.State = EmailClaimLinkState.Removed;
            }

            claim.UpdatedAt = timeProvider.UtcNow;
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
    private async Task<Dictionary<Guid, int>> GetRemainingAliasAllowancesAsync(AliasServerDbContext context, AliasVaultUser caller, IEnumerable<Guid> sharedGroupIds)
    {
        // The caller's personal group is always in play; the shared manifests add their owning groups on top.
        var subjectIds = sharedGroupIds.Append(caller.PersonalGroupId).Distinct().ToList();
        var subjects = await context.Groups.Where(g => subjectIds.Contains(g.Id)).ToListAsync();

        var remaining = new Dictionary<Guid, int>();
        foreach (var group in subjects)
        {
            var groupId = group.Id;
            foreach (var limit in await rateLimitService.GetLimitsAsync(group, RateLimitType.AliasCreation))
            {
                int currentCount;
                if (limit.WindowSeconds == 0)
                {
                    // Global absolute cap: every claim ever charged to this group. A claim is charged to every group it is linked into.
                    currentCount = await context.EmailClaimLinks.Where(l => l.VaultManifest.OwnerGroupId == groupId).Select(l => l.EmailClaimId).Distinct().CountAsync();
                }
                else
                {
                    // Time-based cap: aliases created within the rolling window (create-then-delete still counts).
                    var windowStart = timeProvider.UtcNow.AddSeconds(-limit.WindowSeconds);
                    currentCount = await context.EmailClaimLinks.Where(l => l.EmailClaim.CreatedAt >= windowStart && l.VaultManifest.OwnerGroupId == groupId).Select(l => l.EmailClaimId).Distinct().CountAsync();
                }

                var allowed = limit.MaxCount - currentCount;
                remaining[groupId] = remaining.TryGetValue(groupId, out var existing) ? Math.Min(existing, allowed) : allowed;
            }
        }

        return remaining;
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
    private async Task PublishManifestPublicKeyAsync(AliasServerDbContext context, Guid vaultManifestId, string newPublicKey)
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
            key.UpdatedAt = timeProvider.UtcNow;
        }

        var existingKey = others.FirstOrDefault(x => x.PublicKey == newPublicKey);
        if (existingKey != null)
        {
            existingKey.IsPrimary = true;
            existingKey.UpdatedAt = timeProvider.UtcNow;
            return;
        }

        context.VaultManifestDeliveryKeys.Add(new VaultManifestDeliveryKey
        {
            VaultManifestId = vaultManifestId,
            Algorithm = VaultKeyAlgorithm.RsaOaepSha256,
            PublicKey = newPublicKey,
            IsPrimary = true,
            CreatedAt = timeProvider.UtcNow,
            UpdatedAt = timeProvider.UtcNow,
        });
    }
}
