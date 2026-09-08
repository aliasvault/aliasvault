//-----------------------------------------------------------------------
// <copyright file="VaultBlobRetentionPolicyTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Vault;

using AliasServerDb;

/// <summary>
/// Tests for the rules that decide which encrypted vault blobs the garbage collector may delete.
/// </summary>
public class VaultBlobRetentionPolicyTests
{
    /// <summary>
    /// Test that whatever grace the operator configured is applied as-is, and that a negative value, which only a
    /// hand-edited setting can hold, reads as off rather than as a window.
    /// </summary>
    [Test]
    public void EffectiveGraceHoursUsesTheConfiguredWindow()
    {
        Assert.Multiple(() =>
        {
            Assert.That(VaultBlobRetentionPolicy.EffectiveGraceHours(24), Is.EqualTo(24));
            Assert.That(VaultBlobRetentionPolicy.EffectiveGraceHours(0), Is.EqualTo(0));
            Assert.That(VaultBlobRetentionPolicy.EffectiveGraceHours(-5), Is.EqualTo(0));
        });
    }

    /// <summary>
    /// Test that a blob stays reachable while any revision references it, whichever revision that is, and that the
    /// owner of the stored copy plays no part: a shared manifest's members derive the same hash for the same bytes.
    /// </summary>
    [Test]
    public void UnreferencedOnlyMatchesBlobsNoRevisionHolds()
    {
        var blobs = new[] { Blob("current"), Blob("history"), Blob("other-user"), Blob("orphan") }.AsQueryable();
        var references = new[]
        {
            Reference(Guid.Empty, 2, "current"),
            Reference(Guid.Empty, 1, "history"),
            Reference(Guid.NewGuid(), 5, "other-user"),
        }.AsQueryable();

        var unreferenced = VaultBlobRetentionPolicy.Unreferenced(blobs, references).Select(b => b.Hash);

        Assert.That(unreferenced, Is.EquivalentTo(new[] { "orphan" }));
    }

    /// <summary>
    /// Test that a reference is only considered stale when neither the current revision nor any history revision of
    /// its manifest carries its revision number. A stale reference would pin its blob forever.
    /// </summary>
    [Test]
    public void StaleReferencesOnlyMatchesReferencesToRevisionsThatAreGone()
    {
        var manifestId = Guid.NewGuid();
        var otherManifestId = Guid.NewGuid();
        var references = new[]
        {
            Reference(manifestId, 2, "current"),
            Reference(manifestId, 1, "history"),
            Reference(manifestId, 99, "pruned-revision"),
            Reference(otherManifestId, 2, "other-manifest-same-revision"),
        }.AsQueryable();
        var manifests = new[] { new VaultManifest { ManifestId = manifestId, StorageFormat = VaultManifestBase.ManifestStorageFormat, RevisionNumber = 2 } }.AsQueryable();
        var history = new[] { new VaultManifestsHistory { ManifestId = manifestId, StorageFormat = VaultManifestBase.ManifestStorageFormat, RevisionNumber = 1 } }.AsQueryable();

        var stale = VaultBlobRetentionPolicy.StaleReferences(references, manifests, history).Select(r => r.BlobHash);

        Assert.That(stale, Is.EquivalentTo(new[] { "pruned-revision", "other-manifest-same-revision" }), "A revision number only counts for the manifest it belongs to");
    }

    /// <summary>
    /// Creates a blob object for the tests.
    /// </summary>
    /// <param name="hash">The blob hash, also identifying the row in assertions.</param>
    /// <returns>VaultBlobObject.</returns>
    private static VaultBlobObject Blob(string hash)
    {
        return new VaultBlobObject
        {
            Hash = hash,
            OwnerUserId = "user",
            Category = "logo",
            EncryptedData = [1, 2, 3, 4],
            SizeBytes = 4,
        };
    }

    /// <summary>
    /// Creates a blob reference for the tests.
    /// </summary>
    /// <param name="manifestId">The manifest holding the reference.</param>
    /// <param name="revisionNumber">The revision holding the reference.</param>
    /// <param name="hash">The referenced blob hash.</param>
    /// <returns>VaultBlobReference.</returns>
    private static VaultBlobReference Reference(Guid manifestId, long revisionNumber, string hash)
    {
        return new VaultBlobReference { ManifestId = manifestId, RevisionNumber = revisionNumber, BlobHash = hash };
    }
}
