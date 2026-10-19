//-----------------------------------------------------------------------
// <copyright file="VaultRevisionWriter.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using AliasServerDb;
using AliasVault.Api.Vault;
using AliasVault.Api.Vault.RetentionRules;
using AliasVault.Shared.Models.Enums;
using AliasVault.Shared.Models.WebApi.V2.Vault;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// The revision bookkeeping logic for vault writes, allowing to write new revisions and apply retention policies.
/// </summary>
public static class VaultRevisionWriter
{
    /// <summary>
    /// How many superseded revisions of a data bucket are kept.
    /// </summary>
    public static readonly RetentionPolicy BucketRetentionPolicy = new()
    {
        Rules =
        [
            new RevisionRetentionRule { RevisionsToKeep = 3 },
            new DailyRetentionRule { DaysToKeep = 7 },
        ],
    };

    /// <summary>
    /// How many superseded revisions of a manifest are kept.
    /// </summary>
    public static readonly RetentionPolicy ManifestRetentionPolicy = new()
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
    /// Writes a new revision of a (manifest, bucket kind): the current row is copied to the history table and then updated in place.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="now">The write time.</param>
    /// <param name="manifestId">The manifest that owns the bucket.</param>
    /// <param name="kind">The bucket category.</param>
    /// <param name="encryptedData">The new encrypted payload as raw ciphertext bytes.</param>
    /// <param name="ciphertextHash">Storage-layer integrity hash of the payload.</param>
    /// <param name="currentRevision">The revision the client believes is current, used to seed a first write.</param>
    /// <param name="existing">The current row, already loaded by the revision gate, or null when none exists yet.</param>
    /// <param name="keyVersion">The VEK generation the payload is encrypted with, or null to keep the row's.</param>
    /// <param name="archive">Whether the outgoing revision is kept in history.</param>
    /// <returns>The new revision number.</returns>
    public static async Task<long> UpsertBucketAsync(AliasServerDbContext context, DateTime now, Guid manifestId, VaultDataBucketCategory kind, byte[] encryptedData, string? ciphertextHash, long? currentRevision, VaultDataBucket? existing, int? keyVersion = null, bool archive = true)
    {
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
                KeyVersion = keyVersion ?? 0,
                CreatedAt = now,
                UpdatedAt = now,
            });
            return firstRev;
        }

        // Archive the outgoing revision before overwriting it, exactly as the manifest write path does.
        var archived = archive ? VaultDataBucketsHistory.CreateFrom(existing) : null;
        if (archived is not null)
        {
            context.VaultDataBucketsHistory.Add(archived);
        }

        var newRev = existing.RevisionNumber + 1;
        existing.EncryptedData = encryptedData;
        existing.CiphertextHash = ciphertextHash;
        existing.RevisionNumber = newRev;
        existing.KeyVersion = keyVersion ?? existing.KeyVersion;
        existing.UpdatedAt = now;

        if (archived is not null)
        {
            await ApplyBucketRetentionAsync(context, now, manifestId, kind, archived);
        }

        return newRev;
    }

    /// <summary>
    /// Prunes superseded revisions of one bucket down to <see cref="BucketRetentionPolicy"/>.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="now">The write time.</param>
    /// <param name="manifestId">The manifest that owns the bucket.</param>
    /// <param name="kind">The bucket category.</param>
    /// <param name="justArchived">The revision archived by this write, included in the retention window.</param>
    /// <returns>A task.</returns>
    public static async Task ApplyBucketRetentionAsync(AliasServerDbContext context, DateTime now, Guid manifestId, VaultDataBucketCategory kind, VaultDataBucketsHistory justArchived)
    {
        var history = await context.VaultDataBucketsHistory.Where(x => x.ManifestId == manifestId && x.Category == kind && x.RevisionNumber != justArchived.RevisionNumber).ToListAsync();
        history.Add(justArchived);

        var toDelete = VaultRetentionManager.ApplyRetention(BucketRetentionPolicy, history, now);
        if (toDelete.Count > 0)
        {
            context.VaultDataBucketsHistory.RemoveRange(toDelete);
        }
    }

    /// <summary>
    /// Applies <see cref="ManifestRetentionPolicy"/> to the history revisions of a manifest and removes the pruned
    /// revisions and their blob references. Runs after the previous current revision has been archived (passed as
    /// <paramref name="justArchived"/>, still unsaved, null when there was nothing to archive) and the current row
    /// has been updated in place.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="now">The write time.</param>
    /// <param name="currentManifest">The manifest row as updated by the write.</param>
    /// <param name="justArchived">The revision archived by this write, or null.</param>
    /// <returns>A task.</returns>
    public static async Task ApplyManifestRetentionAsync(AliasServerDbContext context, DateTime now, VaultManifest currentManifest, VaultManifestsHistory? justArchived)
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

        var revisionsToDelete = VaultRetentionManager.ApplyRetention(ManifestRetentionPolicy, historyRevisions, now, currentManifest);
        context.VaultManifestsHistory.RemoveRange(revisionsToDelete);

        // Blob references of pruned revisions are deleted explicitly (they only cascade with the whole manifest).
        var prunedRevisionNumbers = revisionsToDelete.Select(x => x.RevisionNumber).ToList();
        if (prunedRevisionNumbers.Count > 0)
        {
            await context.VaultBlobReferences.Where(r => r.ManifestId == currentManifest.ManifestId && prunedRevisionNumbers.Contains(r.RevisionNumber)).ExecuteDeleteAsync();
        }
    }

    /// <summary>
    /// Publishes <paramref name="newPublicKey"/> as the primary mail delivery key of a manifest and demotes the previous one.
    /// </summary>
    /// <param name="context">Database context.</param>
    /// <param name="now">The write time.</param>
    /// <param name="vaultManifestId">
    /// The manifest this key belongs to: the caller's personal manifest for their personal key, a shared manifest
    /// for its delivery key. Everything here is scoped by it, promoting a shared manifest's key must never demote
    /// the user's personal key, and rotating the personal key must never demote a shared manifest's delivery key. The key
    /// carries no user owner at all: it must survive the publishing admin deleting their account, and a later
    /// admin republishing must land on the same scope rather than a per-user copy.
    /// </param>
    /// <param name="newPublicKey">The public key to publish.</param>
    /// <param name="algorithm">The algorithm of the public key.</param>
    /// <returns>A task.</returns>
    public static async Task PublishManifestPublicKeyAsync(AliasServerDbContext context, DateTime now, Guid vaultManifestId, string newPublicKey, VaultKeyAlgorithm algorithm)
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
            key.UpdatedAt = now;
        }

        var existingKey = others.FirstOrDefault(x => x.PublicKey == newPublicKey);
        if (existingKey != null)
        {
            existingKey.IsPrimary = true;
            existingKey.UpdatedAt = now;
            return;
        }

        context.VaultManifestDeliveryKeys.Add(new VaultManifestDeliveryKey
        {
            VaultManifestId = vaultManifestId,
            Algorithm = algorithm,
            PublicKey = newPublicKey,
            IsPrimary = true,
            CreatedAt = now,
            UpdatedAt = now,
        });
    }
}
