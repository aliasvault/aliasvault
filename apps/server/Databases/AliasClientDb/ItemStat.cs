//-----------------------------------------------------------------------
// <copyright file="ItemStat.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasClientDb;

using System.ComponentModel.DataAnnotations;
using AliasClientDb.Abstracts;

/// <summary>
/// Usage statistics for a single item: when it was last used and how often.
/// </summary>
public class ItemStat : ManifestScopedEntity
{
    /// <summary>
    /// Gets or sets the id of the item these statistics describe. Also this row's own primary key.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the moment the item was last used by any of the tracked actions, or null when never used.
    /// This is the aggregate a client sorts and reports on.
    /// </summary>
    public DateTime? LastUsedAt { get; set; }

    /// <summary>
    /// Gets or sets how often the item was used, across all tracked actions.
    /// <para>
    /// Approximate by design: the merge resolves conflicts last-write-wins, which cannot sum counters, so the
    /// newest writer's value wins wholesale and uses made on a device that syncs later are lost.
    /// </para>
    /// </summary>
    public int UseCount { get; set; }

    /// <summary>
    /// Gets or sets the moment the item was last autofilled into a page, or null when it never was.
    /// </summary>
    public DateTime? LastAutofilledAt { get; set; }

    /// <summary>
    /// Gets or sets how often the item was autofilled. Approximate, for the reason given on <see cref="UseCount"/>.
    /// </summary>
    public int AutofillCount { get; set; }

    /// <summary>
    /// Gets or sets the moment a field of the item was last copied to the clipboard, or null when none ever was.
    /// </summary>
    public DateTime? LastCopiedAt { get; set; }

    /// <summary>
    /// Gets or sets how often a field of the item was copied. Approximate, for the reason given on <see cref="UseCount"/>.
    /// </summary>
    public int CopyCount { get; set; }

    /// <summary>
    /// Gets or sets the moment the item's passkey last served a WebAuthn assertion, or null when it never did.
    /// </summary>
    public DateTime? LastPasskeyAuthAt { get; set; }

    /// <summary>
    /// Gets or sets how often the item's passkey served an assertion. Approximate, for the reason given on <see cref="UseCount"/>.
    /// </summary>
    public int PasskeyAuthCount { get; set; }
}
