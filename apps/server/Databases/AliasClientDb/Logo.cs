//-----------------------------------------------------------------------
// <copyright file="Logo.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasClientDb;

using System.ComponentModel.DataAnnotations;
using AliasClientDb.Abstracts;

/// <summary>
/// Logo entity for deduplicated logo storage.
/// </summary>
public class Logo : SyncableEntity
{
    /// <summary>
    /// Gets or sets the logo ID.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the source domain (e.g., 'github.com').
    /// Unique per manifest scope (see <see cref="SharedFolderId"/>), so logos are deduplicated within
    /// the personal vault and within each shared folder, but never across them.
    /// </summary>
    [Required]
    [StringLength(255)]
    public string Source { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the shared folder this logo belongs to, or null when it belongs to the user's own
    /// (personal) vault. A logo lives in exactly one manifest: two members of a shared folder each keep
    /// their own personal icon for a domain while the folder keeps the one its items use.
    /// </summary>
    public Guid? SharedFolderId { get; set; }

    /// <summary>
    /// Gets or sets the logo file data.
    /// </summary>
    public byte[]? FileData { get; set; }

    /// <summary>
    /// Gets or sets the MIME type of the logo.
    /// </summary>
    [StringLength(100)]
    public string? MimeType { get; set; }

    /// <summary>
    /// Gets or sets the timestamp when the logo was fetched.
    /// </summary>
    public DateTime? FetchedAt { get; set; }

    /// <summary>
    /// Gets or sets the items using this logo.
    /// </summary>
    public virtual ICollection<Item> Items { get; set; } = [];
}
