//-----------------------------------------------------------------------
// <copyright file="EmailKeyWrapApiModel.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Email;

/// <summary>
/// One wrapped copy of an email's symmetric key. The client picks the wrap whose public key matches a keypair
/// it holds locally (a personal key or a shared manifest's delivery key) and unwraps with the private half.
/// </summary>
public class EmailKeyWrapApiModel
{
    /// <summary>
    /// Gets or sets the public key whose private half unwraps this wrap.
    /// </summary>
    public string PublicKey { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the email's symmetric key, encrypted with the public key.
    /// </summary>
    public string EncryptedSymmetricKey { get; set; } = string.Empty;
}
