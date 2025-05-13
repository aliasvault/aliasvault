//-----------------------------------------------------------------------
// <copyright file="TotpCodeEdit.cs" company="lanedirt">
// Copyright (c) lanedirt. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Main.Models;

using System;
using System.ComponentModel.DataAnnotations;
using AliasClientDb;

/// <summary>
/// Credential edit model.
/// </summary>
public sealed class TotpCodeEdit
{
    /// <summary>
    /// Gets or sets the Id of the TOTP code.
    /// </summary>
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the name of the TOTP code.
    /// </summary>
    public string? Name { get; set; }

    /// <summary>
    /// Gets or sets the secret key of the TOTP code.
    /// </summary>
    [Required(ErrorMessage = "Secret key is required")]
    public string SecretKey { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the created at date of the TOTP code.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the updated at date of the TOTP code.
    /// </summary>
    public DateTime UpdatedAt { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the TOTP code is deleted.
    /// </summary>
    public bool IsDeleted { get; set; }

    /// <summary>
    /// Converts the edit model to a TotpCode entity.
    /// </summary>
    /// <returns>The TotpCode entity.</returns>
    public TotpCode ToEntity()
    {
        return new TotpCode
        {
            Id = Id,
            Name = Name ?? string.Empty,
            SecretKey = SecretKey,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            IsDeleted = IsDeleted,
        };
    }
}
