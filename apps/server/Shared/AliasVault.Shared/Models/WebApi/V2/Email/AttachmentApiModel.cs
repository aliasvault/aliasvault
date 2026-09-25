//-----------------------------------------------------------------------
// <copyright file="AttachmentApiModel.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Email;

/// <summary>
/// Represents an attachment of an email served by the AliasVault V2 email API.
/// </summary>
public class AttachmentApiModel
{
    /// <summary>
    /// Gets or sets the ID of the attachment.
    /// </summary>
    public int Id { get; set; }

    /// <summary>
    /// Gets or sets the ID of the email the attachment belongs to.
    /// </summary>
    public int Email_Id { get; set; }

    /// <summary>
    /// Gets or sets the filename of the attachment.
    /// </summary>
    public string Filename { get; set; } = null!;

    /// <summary>
    /// Gets or sets the MIME type of the attachment.
    /// </summary>
    public string MimeType { get; set; } = null!;

    /// <summary>
    /// Gets or sets the size of the attachment in bytes.
    /// </summary>
    public int Filesize { get; set; }
}
