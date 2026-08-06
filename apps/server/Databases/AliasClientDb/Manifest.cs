//-----------------------------------------------------------------------
// <copyright file="Manifest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasClientDb;

using System.ComponentModel.DataAnnotations;

/// <summary>
/// Local bookkeeping: one row per manifest this vault is materialized from filled by the
/// Rust codec on every materialize.
/// </summary>
public class Manifest
{
    /// <summary>
    /// Gets or sets the manifest id (the server-side VaultManifest id).
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the display name of this manifest, or null when it has none.
    /// </summary>
    public string? Name { get; set; }
}
