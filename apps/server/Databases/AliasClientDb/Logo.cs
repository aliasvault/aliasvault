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
/// An item's logo.
/// </summary>
public class Logo : ManifestScopedEntity
{
    /// <summary>
    /// The <see cref="Kind"/> of a logo fetched automatically from an item's URL. <see cref="Source"/>
    /// is the domain it was fetched from.
    /// </summary>
    public const string KindFavicon = "favicon";

    /// <summary>
    /// The <see cref="Kind"/> of a logo the user picked from the built-in catalog. <see cref="Source"/>
    /// is the catalog key (see core/models/src/icons/AppIcons.ts) and there is no image data: every
    /// platform draws the logo itself.
    /// </summary>
    public const string KindBuiltin = "builtin";

    /// <summary>
    /// The <see cref="Kind"/> of a logo the user uploaded. <see cref="Source"/> is the sha256 of
    /// <see cref="FileData"/> as lowercase hex, which is what makes an uploaded image reusable: picking
    /// it again resolves to the row that already holds those bytes.
    /// </summary>
    public const string KindCustom = "custom";

    /// <summary>
    /// Gets or sets the logo ID. Deterministically derived from (ManifestId, Kind, Source) via Rust core.
    /// </summary>
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets where this logo comes from: <see cref="KindFavicon"/>, <see cref="KindBuiltin"/>, or
    /// <see cref="KindCustom"/>. It is part of the natural key because each kind keys <see cref="Source"/>
    /// in its own space. An unrecognized kind is ignored by the UI and falls back to a placeholder.
    /// </summary>
    [Required]
    [StringLength(20)]
    public string Kind { get; set; } = KindFavicon;

    /// <summary>
    /// Gets or sets this icon's natural key within its <see cref="Kind"/>: the source domain
    /// ('github.com') for a favicon, the catalog key ('shopping') for a built-in icon, or the image's
    /// sha256 for an uploaded one.
    /// Unique per manifest (see <see cref="Abstracts.ManifestScopedEntity.ManifestId"/>), so logos are
    /// deduplicated within each manifest.
    /// </summary>
    [Required]
    [StringLength(255)]
    public string Source { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the logo image data. Null for <see cref="KindBuiltin"/>, which carries no bytes.
    /// </summary>
    public byte[]? FileData { get; set; }

    /// <summary>
    /// Gets or sets an optional user-facing label, shown for uploaded logos in the logo library.
    /// </summary>
    [StringLength(255)]
    public string? Name { get; set; }

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
