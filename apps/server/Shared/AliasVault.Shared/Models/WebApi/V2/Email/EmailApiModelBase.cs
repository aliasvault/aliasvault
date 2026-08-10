//-----------------------------------------------------------------------
// <copyright file="EmailApiModelBase.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Email;

/// <summary>
/// Represents the base email API model. Decryptability is expressed exclusively through
/// <see cref="Wraps"/>: one wrapped symmetric key per manifest keypair the caller holds.
/// </summary>
public abstract class EmailApiModelBase
{
    /// <summary>
    /// Gets or sets the ID of the email.
    /// </summary>
    public int Id { get; set; }

    /// <summary>
    /// Gets or sets the subject of the email.
    /// </summary>
    public string Subject { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the display name of the sender.
    /// </summary>
    public string FromDisplay { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the domain of the sender's email address.
    /// </summary>
    public string FromDomain { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the local part of the sender's email address.
    /// </summary>
    public string FromLocal { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the domain of the recipient's email address.
    /// </summary>
    public string ToDomain { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the local part of the recipient's email address.
    /// </summary>
    public string ToLocal { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the date of the email.
    /// </summary>
    public DateTime Date { get; set; }

    /// <summary>
    /// Gets or sets the system date of the email.
    /// </summary>
    public DateTime DateSystem { get; set; }

    /// <summary>
    /// Gets or sets the number of seconds ago the email was received.
    /// </summary>
    public double SecondsAgo { get; set; }

    /// <summary>
    /// Gets or sets the wrapped copies of the email's symmetric key the caller can open, one per manifest keypair
    /// the caller holds (their personal key, plus the delivery key of every shared manifest they can access).
    /// </summary>
    public List<EmailKeyWrapApiModel> Wraps { get; set; } = [];
}
