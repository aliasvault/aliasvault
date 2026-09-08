//-----------------------------------------------------------------------
// <copyright file="ManifestRevisionRow.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Main.Models;

using AliasServerDb;

/// <summary>
/// One revision of a vault manifest as shown in the admin, with the blob usage that revision references.
/// </summary>
public sealed class ManifestRevisionRow
{
    /// <summary>
    /// Gets the id of the logical manifest this revision belongs to.
    /// </summary>
    public Guid ManifestId { get; init; }

    /// <summary>
    /// Gets the revision number.
    /// </summary>
    public long RevisionNumber { get; init; }

    /// <summary>
    /// Gets a value indicating whether this is the live revision rather than an archived one.
    /// </summary>
    public bool IsCurrent { get; init; }

    /// <summary>
    /// Gets the storage format this revision was written in.
    /// </summary>
    public string StorageFormat { get; init; } = string.Empty;

    /// <summary>
    /// Gets the vault data model version. Only legacy revisions carry one.
    /// </summary>
    public string? Version { get; init; }

    /// <summary>
    /// Gets the size of the encrypted manifest (or legacy vault blob) in bytes, derived from the kilobytes the
    /// server records per revision, so it is accurate to a kilobyte.
    /// </summary>
    public long SizeBytes { get; init; }

    /// <summary>
    /// Gets or sets the number of blob objects this revision references.
    /// </summary>
    public int BlobCount { get; set; }

    /// <summary>
    /// Gets or sets the total size of the blob objects this revision references, in bytes.
    /// </summary>
    public long BlobBytes { get; set; }

    /// <summary>
    /// Gets the number of credentials the vault held at this revision.
    /// </summary>
    public int CredentialsCount { get; init; }

    /// <summary>
    /// Gets the number of email aliases filed against this manifest at this revision.
    /// </summary>
    public int EmailClaimsCount { get; init; }

    /// <summary>
    /// Gets the client that wrote this revision.
    /// </summary>
    public string? Client { get; init; }

    /// <summary>
    /// Gets the SRP salt carried by this revision. Only legacy revisions carry one.
    /// </summary>
    public string? Salt { get; init; }

    /// <summary>
    /// Gets the SRP verifier carried by this revision. Only legacy revisions carry one.
    /// </summary>
    public string? Verifier { get; init; }

    /// <summary>
    /// Gets the timestamp this revision was written.
    /// </summary>
    public DateTime UpdatedAt { get; init; }

    /// <summary>
    /// Gets a value indicating whether this revision predates the manifest storage format.
    /// </summary>
    public bool IsLegacy => StorageFormat == VaultManifestBase.LegacyStorageFormat;
}
