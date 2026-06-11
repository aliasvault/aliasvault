//-----------------------------------------------------------------------
// <copyright file="VaultManifest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// A single revision of a vault manifest. Each save inserts a new row. All rows sharing a <see cref="ManifestId"/>
/// are revisions of the same logical manifest (e.g. main vault or shared folder).
/// </summary>
public class VaultManifest
{
    /// <summary>
    /// Gets or sets the per-revision primary key. Unique to this single revision.
    /// </summary>
    [Key]
    public Guid RevisionId { get; set; }

    /// <summary>
    /// Gets or sets the stable identifier of the logical manifest this row is a revision of. Constant across every
    /// revision of the same manifest.
    /// </summary>
    public Guid ManifestId { get; set; }

    /// <summary>
    /// Gets or sets the manifest kind.
    /// </summary>
    public required VaultManifestCategory Category { get; set; }

    /// <summary>
    /// Gets or sets the ID of the owning user.
    /// </summary>
    [StringLength(255)]
    public string OwnerUserId { get; set; } = null!;

    /// <summary>
    /// Gets or sets foreign key to the AliasVaultUser object.
    /// </summary>
    [ForeignKey("OwnerUserId")]
    public virtual AliasVaultUser User { get; set; } = null!;

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
    /// Gets or sets the revision number of the vault.
    /// This number is incremented with each change to the vault manifest.
    /// </summary>
    [Required]
    public required long RevisionNumber { get; set; }

    /// <summary>
    /// Gets or sets the vault filesize in kilobytes.
    /// </summary>
    public int FileSize { get; set; }

    /// <summary>
    /// Gets or sets the salt used for SRP authentication. Note: the login credentials are stored with the vault manifest
    /// because the vault manifest is encrypted with the same key derived from the user's password. So the password the user
    /// uses to log in to AliasVault needs to be the same as the vault manifest to keep everything in-sync in case of vault
    /// backup restores.
    /// </summary>
    [StringLength(100)]
    public required string Salt { get; set; }

    /// <summary>
    /// Gets or sets the verifier used for SRP authentication. Note: the login credentials are stored with the vault
    /// manifest because the vault manifest is encrypted with the same key derived from the user's password. So the password the
    /// user uses to log in to AliasVault needs to be the same as the vault to keep everything in-sync in case of vault
    /// backup restores.
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
    /// Gets or sets the encryption type.
    /// </summary>
    public required string EncryptionType { get; set; }

    /// <summary>
    /// Gets or sets the encryption settings as a JSON string.
    /// </summary>
    public required string EncryptionSettings { get; set; }

    /// <summary>
    /// Gets or sets the client that created the vault.
    /// </summary>
    [StringLength(255)]
    public string? Client { get; set; }

    /// <summary>
    /// Gets or sets created timestamp.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets updated timestamp.
    /// </summary>
    public DateTime UpdatedAt { get; set; }
}
