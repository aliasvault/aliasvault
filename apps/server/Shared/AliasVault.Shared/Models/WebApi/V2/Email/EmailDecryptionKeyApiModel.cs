//-----------------------------------------------------------------------
// <copyright file="EmailDecryptionKeyApiModel.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Email;

/// <summary>
/// One encrypted copy of an email's symmetric key. The client picks the copy whose public key matches a keypair
/// it holds locally (a personal key or a shared manifest's delivery key) and decrypts it with the private half.
/// </summary>
public class EmailDecryptionKeyApiModel
{
    /// <summary>
    /// Gets or sets the position of the public key in the response-level public key table. The key itself is sent
    /// once as part of the full response.
    /// </summary>
    public int KeyIndex { get; set; }

    /// <summary>
    /// Gets or sets the email's symmetric key, encrypted with the public key.
    /// </summary>
    public string EncryptedSymmetricKey { get; set; } = string.Empty;
}
