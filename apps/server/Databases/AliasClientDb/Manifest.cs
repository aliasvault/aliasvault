//-----------------------------------------------------------------------
// <copyright file="Manifest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasClientDb;

using System.ComponentModel.DataAnnotations;

/// <summary>
/// Local bookkeeping: one row per manifest this vault is materialized from, written by the Rust codec
/// on every materialize (and by the app at fresh-vault creation for the root row). Never synced — the
/// codec treats it as a skip-table and derives it from the manifest set — it exists so queries can
/// resolve "the root manifest id" (WHERE IsRoot = 1) without a NULL-scope convention, and so every
/// stamped row's ManifestId terminates at a real parent row.
/// </summary>
public class Manifest
{
    /// <summary>
    /// Gets or sets the manifest id (the server-side VaultManifest id).
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether this is the vault's root (personal) manifest.
    /// </summary>
    public bool IsRoot { get; set; }

    /// <summary>
    /// Gets or sets the folder this manifest is anchored at (a shared manifest's anchor folder), or null
    /// for the root manifest. Presentation and routing hint only — the manifest's identity is
    /// <see cref="Id"/>.
    /// </summary>
    public Guid? AnchorFolderId { get; set; }
}
