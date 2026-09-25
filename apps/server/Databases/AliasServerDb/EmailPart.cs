//-----------------------------------------------------------------------
// <copyright file="EmailPart.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

using Microsoft.EntityFrameworkCore;

/// <summary>
/// Represents an attachment body that was detached from an email's MIME source at ingest so that opening the
/// email does not require downloading its attachments. The source itself keeps the attachment's part headers,
/// which is where the filename and MIME type live.
/// </summary>
[Index(nameof(EmailId), nameof(PartIndex), IsUnique = true)]
public class EmailPart
{
    /// <summary>
    /// Gets or sets the ID of the part.
    /// </summary>
    public int Id { get; set; }

    /// <summary>
    /// Gets or sets the ID of the email that the part was detached from.
    /// </summary>
    public int EmailId { get; set; }

    /// <summary>
    /// Gets or sets the email that the part was detached from.
    /// </summary>
    public virtual Email Email { get; set; } = null!;

    /// <summary>
    /// Gets or sets the index that identifies this part within its email. The same value is stamped on the
    /// detached part in the message source as the X-AliasVault-Part header, which is how clients know which
    /// part to request.
    /// </summary>
    public int PartIndex { get; set; }

    /// <summary>
    /// Gets or sets the detached part body.
    /// </summary>
    public byte[] Bytes { get; set; } = null!;
}
