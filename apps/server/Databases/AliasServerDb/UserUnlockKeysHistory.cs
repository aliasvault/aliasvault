//-----------------------------------------------------------------------
// <copyright file="UserUnlockKeysHistory.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using AliasVault.Shared.Models.Enums;

/// <summary>
/// A superseded <see cref="UserUnlockKey"/>, archived on a credential change to aid in reverting to
/// previous credentials in case of a password change failure. These historic rows are automatically pruned
/// after a certain number of days by the TaskRunner as configured by the server administrator.
/// </summary>
public class UserUnlockKeysHistory
{
    /// <summary>
    /// Gets or sets the primary key.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the id of the <see cref="UserUnlockKey"/> row this is a superseded version of.
    /// </summary>
    public Guid UnlockKeyId { get; set; }

    /// <summary>
    /// Gets or sets the foreign key to the user this archived unlock key belonged to.
    /// </summary>
    [StringLength(255)]
    public required string UserId { get; set; }

    /// <summary>
    /// Gets or sets the user object.
    /// </summary>
    [ForeignKey("UserId")]
    public virtual AliasVaultUser User { get; set; } = null!;

    /// <summary>
    /// Gets or sets the unlock method this row represents.
    /// </summary>
    [StringLength(30)]
    public required UnlockMethodType Type { get; set; }

    /// <summary>
    /// Gets or sets the algorithm <see cref="EncryptedAccountKey"/> is encrypted with.
    /// </summary>
    [StringLength(30)]
    public required VaultKeyAlgorithm Algorithm { get; set; }

    /// <summary>
    /// Gets or sets the label the archived method carried.
    /// </summary>
    [StringLength(100)]
    public string Label { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the Account Key encrypted with this method's superseded KEK.
    /// </summary>
    public required string EncryptedAccountKey { get; set; }

    /// <summary>
    /// Gets or sets the version of the Account Key that <see cref="EncryptedAccountKey"/> contains.
    /// </summary>
    public int AccountKeyVersion { get; set; }

    /// <summary>
    /// Gets or sets the superseded unlock key's metadata as JSON: SRP salt and verifier, KDF parameters etc. Read and
    /// written through <see cref="VaultKeyMetadata"/>.
    /// </summary>
    public string? Metadata { get; set; }

    /// <summary>
    /// Gets or sets the timestamp at which the archived unlock method was originally created.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the timestamp at which the archived unlock key was last updated before being superseded.
    /// </summary>
    public DateTime UpdatedAt { get; set; }

    /// <summary>
    /// Gets or sets the timestamp at which this archived unlock key was archived. Retention is measured from here.
    /// </summary>
    public DateTime ArchivedAt { get; set; }

    /// <summary>
    /// Gets or sets the client that performed the credential change which superseded this archived unlock key.
    /// </summary>
    [StringLength(255)]
    public string? ArchivedByClient { get; set; }

    /// <summary>
    /// Creates a history row from an unlock key that is about to be overwritten with new credentials.
    /// </summary>
    /// <param name="current">The unlock key row to archive.</param>
    /// <param name="archivedAt">The timestamp retention is measured from.</param>
    /// <param name="client">The client performing the credential change, or null when unknown.</param>
    /// <returns>A new unsaved history entity carrying the current row's credentials.</returns>
    public static UserUnlockKeysHistory CreateFrom(UserUnlockKey current, DateTime archivedAt, string? client)
    {
        return new UserUnlockKeysHistory
        {
            Id = Guid.NewGuid(),
            UnlockKeyId = current.Id,
            UserId = current.UserId,
            Type = current.Type,
            Algorithm = current.Algorithm,
            Label = current.Label,
            EncryptedAccountKey = current.EncryptedAccountKey,
            AccountKeyVersion = current.AccountKeyVersion,
            Metadata = current.Metadata,
            CreatedAt = current.CreatedAt,
            UpdatedAt = current.UpdatedAt,
            ArchivedAt = archivedAt,
            ArchivedByClient = client,
        };
    }

    /// <summary>
    /// Copies this archived row's credentials back onto a live unlock key, reverting it to these credentials.
    /// </summary>
    /// <param name="target">The live unlock key row to restore onto.</param>
    /// <param name="now">The timestamp to stamp the restore with.</param>
    public void RestoreOnto(UserUnlockKey target, DateTime now)
    {
        target.Algorithm = Algorithm;
        target.EncryptedAccountKey = EncryptedAccountKey;
        target.AccountKeyVersion = AccountKeyVersion;
        target.Metadata = Metadata;
        target.UpdatedAt = now;
    }
}
