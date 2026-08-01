//-----------------------------------------------------------------------
// <copyright file="AliasVaultUser.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

using Microsoft.AspNetCore.Identity;

/// <summary>
/// Alias vault user extending IdentityUser with fields for SRP authentication.
/// </summary>
public class AliasVaultUser : IdentityUser
{
    /// <summary>
    /// Gets or sets the SRP identity used for authentication. This is a fixed value that is used for all SRP operations,
    /// is set during registration, and never changes.
    /// </summary>
    [System.ComponentModel.DataAnnotations.StringLength(255)]
    public string? SrpIdentity { get; set; }

    /// <summary>
    /// Gets or sets the user's personal <see cref="Group"/>: the group that owns their root vault and personal
    /// email claims.
    /// </summary>
    public Guid PersonalGroupId { get; set; }

    /// <summary>
    /// Gets or sets the navigation property to the user's personal group.
    /// </summary>
    public virtual Group PersonalGroup { get; set; } = null!;

    /// <summary>
    /// Gets or sets created timestamp.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the timestamp when the user's password was last changed.
    /// </summary>
    public DateTime PasswordChangedAt { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the user is blocked and should not be able to log in.
    /// </summary>
    public bool Blocked { get; set; }

    /// <summary>
    /// Gets or sets the UTC timestamp when the user was last blocked. Null when the user has never been blocked.
    /// Kept as a small trace of when the block was activated.
    /// </summary>
    public DateTime? BlockedAt { get; set; }

    /// <summary>
    /// Gets or sets updated timestamp.
    /// </summary>
    public DateTime UpdatedAt { get; set; }

    /// <summary>
    /// Gets or sets the date of the user's last activity (login, API call, etc.).
    /// Updated automatically on successful authentication events.
    /// </summary>
    public DateTime? LastActivityDate { get; set; }

    /// <summary>
    /// Gets or sets the collection of vault unlock keys (KEK/VEK model). Empty for users still on the legacy
    /// model where the password-derived key encrypts the vault directly.
    /// </summary>
    public virtual ICollection<VaultManifestAccessKey> VaultManifestAccessKeys { get; set; } = [];
}
