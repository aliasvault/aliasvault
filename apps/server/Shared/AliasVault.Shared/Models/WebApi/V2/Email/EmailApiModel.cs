//-----------------------------------------------------------------------
// <copyright file="EmailApiModel.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Email;

/// <summary>
/// Represents the email API model.
/// </summary>
public class EmailApiModel : EmailApiModelBase
{
    /// <summary>
    /// Gets or sets the public keys referenced by this email's decryption keys. A decryption key's
    /// <see cref="EmailDecryptionKeyApiModel.KeyIndex"/> is its position in this list.
    /// </summary>
    public List<string> PublicKeys { get; set; } = [];

    /// <summary>
    /// Gets or sets the source content of the email message as base64 ciphertext which contains the raw RFC 822 message bytes.
    /// The other MessagePlain and MessageHtml DB fields are no longer served by the v2 API as these columns are deprecated,
    /// only filled in for legacy emails (pre-0.31.0) and will be removed from the DB in a future version.
    /// </summary>
    public string? MessageSource { get; set; }
}
