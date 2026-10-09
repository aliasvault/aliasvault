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
/// Usage statistics of one item on one device: when it was last used and how often.
/// </summary>
/// <remarks>
/// A device only ever writes its own row, so the last-write-wins merge never has to resolve two devices' counts
/// against each other. A reader sums the counts and takes the latest timestamps over an item's rows.
/// </remarks>
public class ItemStat : ManifestScopedEntity
{
    /// <summary>
    /// Gets or sets the id of the item these statistics describe.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the id of the device that recorded these uses (a random id per install, kept outside the vault).
    /// </summary>
    public string DeviceId { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the moment the item was last used by any of the tracked actions, or null when never used.
    /// </summary>
    public DateTime? LastUsedAt { get; set; }

    /// <summary>
    /// Gets or sets how often the item was used, across all tracked actions.
    /// </summary>
    public int UseCount { get; set; }

    /// <summary>
    /// Gets or sets the moment the item was last autofilled into a page, or null when it never was.
    /// </summary>
    public DateTime? LastAutofilledAt { get; set; }

    /// <summary>
    /// Gets or sets how often the item was autofilled.
    /// </summary>
    public int AutofillCount { get; set; }

    /// <summary>
    /// Gets or sets the moment a field of the item was last copied to the clipboard, or null when none ever was.
    /// </summary>
    public DateTime? LastCopiedAt { get; set; }

    /// <summary>
    /// Gets or sets how often a field of the item was copied.
    /// </summary>
    public int CopyCount { get; set; }

    /// <summary>
    /// Gets or sets the moment the item's passkey last served a WebAuthn assertion, or null when it never did.
    /// </summary>
    public DateTime? LastPasskeyAuthAt { get; set; }

    /// <summary>
    /// Gets or sets how often the item's passkey served an assertion.
    /// </summary>
    public int PasskeyAuthCount { get; set; }
}
