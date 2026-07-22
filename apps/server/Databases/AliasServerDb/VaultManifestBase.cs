//-----------------------------------------------------------------------
// <copyright file="VaultManifestBase.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;

/// <summary>
/// Shared revision payload columns for a vault manifest. <see cref="VaultManifest"/> holds the current revision of
/// each logical manifest (one row per manifest); <see cref="VaultManifestsHistory"/> holds superseded revisions.
/// </summary>
public abstract class VaultManifestBase
{
    /// <summary>
    /// Gets or sets the encrypted vault blob (only used by legacy sqlite-blob format). Not used anymore in new format.
    /// </summary>
    public required string VaultBlob { get; set; }

    /// <summary>
    /// Gets or sets the storage format identifier: "sqlite-blob" (legacy v1) or "manifest-v1" (v2).
    /// </summary>
    [StringLength(20)]
    public required string StorageFormat { get; set; }

    /// <summary>
    /// Gets or sets the encrypted manifest blob (AES-GCM ciphertext, base64-encoded).
    /// </summary>
    public string? ManifestBlob { get; set; }

    /// <summary>
    /// Gets or sets the SHA-256 (hex) of the encrypted manifest ciphertext. Stored for storage-layer integrity
    /// verification (the client sends this on upload and we return it on download; client verifies before decrypt).
    /// </summary>
    [StringLength(64)]
    public string? ManifestCiphertextHash { get; set; }

    /// <summary>
    /// Gets or sets the vault data model version.
    /// </summary>
    [StringLength(255)]
    public required string Version { get; set; }

    /// <summary>
    /// Gets or sets the revision number of the vault manifest. This number is incremented with each change.
    /// </summary>
    [Required]
    public required long RevisionNumber { get; set; }

    /// <summary>
    /// Gets or sets the vault filesize in kilobytes.
    /// </summary>
    public int FileSize { get; set; }

    /// <summary>
    /// Gets or sets the salt used for SRP authentication. On the legacy model the login
    /// credentials are stored with the vault manifest because the manifest is encrypted with the key derived from
    /// the user's password, keeping login and vault password in sync across backup restores. Once a user has a VaultKey
    /// the SRP credentials live there instead and this column is empty on current revisions (history revisions keep
    /// their at-the-time values). TODO: remove this column once the legacy model is fully deprecated.
    /// </summary>
    [StringLength(100)]
    public required string Salt { get; set; }

    /// <summary>
    /// Gets or sets the verifier used for SRP authentication. See the remarks on
    /// <see cref="Salt"/> for how this relates to the VaultKey model. TODO: remove this column once the legacy model is fully deprecated.
    /// </summary>
    [StringLength(1000)]
    public required string Verifier { get; set; }

    /// <summary>
    /// Gets or sets the number of credentials stored in the vault. This anonymous data is used in case a vault back-up
    /// needs to be restored to get a better idea of the vault size.
    /// </summary>
    public int CredentialsCount { get; set; }

    /// <summary>
    /// Gets or sets the number of email claims stored in the vault. This anonymous data is used in case a vault back-up
    /// needs to be restored to get a better idea of the vault size.
    /// </summary>
    public int EmailClaimsCount { get; set; }

    /// <summary>
    /// Gets or sets the encryption type. See remarks on <see cref="Salt"/> for how this relates to the VaultKey model.
    /// TODO: remove this column once the legacy model is fully deprecated.
    /// </summary>
    public required string EncryptionType { get; set; }

    /// <summary>
    /// Gets or sets the encryption settings. See remarks on <see cref="Salt"/> for how this relates to the VaultKey model.
    /// TODO: remove this column once the legacy model is fully deprecated.
    /// </summary>
    public required string EncryptionSettings { get; set; }

    /// <summary>
    /// Gets or sets the client that created the vault.
    /// </summary>
    [StringLength(255)]
    public string? Client { get; set; }

    /// <summary>
    /// Gets or sets the timestamp at which this revision was created.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the timestamp at which this revision was last updated.
    /// </summary>
    public DateTime UpdatedAt { get; set; }

    /// <summary>
    /// Copies all shared revision payload columns from another manifest revision onto this instance.
    /// </summary>
    /// <param name="source">The revision to copy the payload from.</param>
    public void CopyPayloadFrom(VaultManifestBase source)
    {
        VaultBlob = source.VaultBlob;
        StorageFormat = source.StorageFormat;
        ManifestBlob = source.ManifestBlob;
        ManifestCiphertextHash = source.ManifestCiphertextHash;
        Version = source.Version;
        RevisionNumber = source.RevisionNumber;
        FileSize = source.FileSize;
        Salt = source.Salt;
        Verifier = source.Verifier;
        CredentialsCount = source.CredentialsCount;
        EmailClaimsCount = source.EmailClaimsCount;
        EncryptionType = source.EncryptionType;
        EncryptionSettings = source.EncryptionSettings;
        Client = source.Client;
        CreatedAt = source.CreatedAt;
        UpdatedAt = source.UpdatedAt;
    }
}
