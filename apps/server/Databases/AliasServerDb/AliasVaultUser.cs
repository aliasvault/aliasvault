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
    /// Gets or sets the SRP identity used for authentication. This is a fixed value (typically a random GUID)
    /// that is used for all SRP operations, is set during registration, and never changes.
    /// </summary>
    [System.ComponentModel.DataAnnotations.StringLength(255)]
    public string? SrpIdentity { get; set; }

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
    /// Gets or sets a value indicating whether the user is marked as shadow-blocked.
    /// </summary>
    public bool ShadowBlocked { get; set; }

    /// <summary>
    /// Gets or sets the UTC timestamp when the user was shadow-blocked. Used to only hide emails received after the
    /// block occurred. Null when the user has never been shadow-blocked (in which case all emails are hidden while
    /// ShadowBlocked is true, as a conservative fallback).
    /// </summary>
    public DateTime? ShadowBlockedAt { get; set; }

    /// <summary>
    /// Gets or sets updated timestamp.
    /// </summary>
    public DateTime UpdatedAt { get; set; }

    /// <summary>
    /// Gets or sets the maximum number of emails for all of user's aliases. 0 means unlimited.
    /// </summary>
    public int MaxEmails { get; set; } = 0;

    /// <summary>
    /// Gets or sets the maximum age of emails in days. Emails older than this will be deleted. 0 means unlimited.
    /// </summary>
    public int MaxEmailAgeDays { get; set; } = 0;

    /// <summary>
    /// Gets or sets the date of the user's last activity (login, API call, etc.).
    /// Updated automatically on successful authentication events.
    /// </summary>
    public DateTime? LastActivityDate { get; set; }

    /// <summary>
    /// Gets or sets the total count of emails received by this user across all time.
    /// This is a persistent counter that is incremented when emails are received and is never decremented,
    /// even when emails are deleted. Used for abuse detection and usage statistics.
    /// </summary>
    public int EmailsReceived { get; set; } = 0;

    /// <summary>
    /// Gets or sets the collection of vault manifest revisions owned by this user (across all manifests and kinds).
    /// </summary>
    public virtual ICollection<VaultManifest> VaultManifests { get; set; } = [];

    /// <summary>
    /// Gets or sets the collection of EmailClaims.
    /// </summary>
    public virtual ICollection<UserEmailClaim> EmailClaims { get; set; } = [];

    /// <summary>
    /// Gets or sets the collection of EncryptionKeys.
    /// </summary>
    public virtual ICollection<UserEncryptionKey> EncryptionKeys { get; set; } = [];

    /// <summary>
    /// Gets or sets the collection of vault unlock keys (KEK/VEK model). Empty for users still on the legacy
    /// model where the password-derived key encrypts the vault directly.
    /// </summary>
    public virtual ICollection<VaultKey> VaultKeys { get; set; } = [];
}
