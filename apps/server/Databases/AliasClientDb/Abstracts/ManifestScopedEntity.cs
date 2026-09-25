//-----------------------------------------------------------------------
// <copyright file="ManifestScopedEntity.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasClientDb.Abstracts;

using System.ComponentModel.DataAnnotations;

/// <summary>
/// Represents a syncable entity that lives inside a manifest, which is handled as a namespace.
/// </summary>
public abstract class ManifestScopedEntity : SyncableEntity
{
    /// <summary>
    /// Gets or sets the id of the manifest this entity belongs to.
    /// </summary>
    [Required]
    public Guid ManifestId { get; set; }
}
