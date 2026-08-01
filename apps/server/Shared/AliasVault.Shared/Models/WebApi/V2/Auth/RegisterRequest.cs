//-----------------------------------------------------------------------
// <copyright file="RegisterRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Auth;

/// <summary>
/// Register request model for the v2 endpoint.
/// </summary>
public class RegisterRequest
{
    /// <summary>
    /// Initializes a new instance of the <see cref="RegisterRequest"/> class.
    /// </summary>
    /// <param name="username">The username.</param>
    /// <param name="salt">The salt value.</param>
    /// <param name="verifier">The verifier value.</param>
    /// <param name="encryptionType">The encryption type.</param>
    /// <param name="encryptionSettings">The encryption settings.</param>
    /// <param name="srpIdentity">The SRP identity.</param>
    /// <param name="encryptedVek">The AK encrypted VEK.</param>
    /// <param name="encryptedAccountKey">The KEK encrypted Account Key.</param>
    /// <param name="accountPublicKey">The account public key.</param>
    /// <param name="encryptedAccountPrivateKey">The AK encrypted account private key.</param>
    public RegisterRequest(string username, string salt, string verifier, string encryptionType, string encryptionSettings, string? srpIdentity = null, string? encryptedVek = null, string? encryptedAccountKey = null, string? accountPublicKey = null, string? encryptedAccountPrivateKey = null)
    {
        Username = username.ToLowerInvariant().Trim();
        Salt = salt;
        Verifier = verifier;
        EncryptionType = encryptionType;
        EncryptionSettings = encryptionSettings;
        SrpIdentity = srpIdentity;
        EncryptedVek = encryptedVek;
        EncryptedAccountKey = encryptedAccountKey;
        AccountPublicKey = accountPublicKey;
        EncryptedAccountPrivateKey = encryptedAccountPrivateKey;
    }

    /// <summary>
    /// Gets the username value.
    /// </summary>
    public string Username { get; }

    /// <summary>
    /// Gets the salt value.
    /// </summary>
    public string Salt { get; }

    /// <summary>
    /// Gets the verifier value.
    /// </summary>
    public string Verifier { get; }

    /// <summary>
    /// Gets the encryption type.
    /// </summary>
    public string EncryptionType { get; }

    /// <summary>
    /// Gets the encryption settings.
    /// </summary>
    public string EncryptionSettings { get; }

    /// <summary>
    /// Gets the SRP identity used for authentication.
    /// </summary>
    public string? SrpIdentity { get; }

    /// <summary>
    /// Gets the encrypted VEK.
    /// </summary>
    public string? EncryptedVek { get; }

    /// <summary>
    /// Gets the Account Key encrypted with the password-derived KEK.
    /// </summary>
    public string? EncryptedAccountKey { get; }

    /// <summary>
    /// Gets the account public key.
    /// </summary>
    public string? AccountPublicKey { get; }

    /// <summary>
    /// Gets the account private key encrypted with the Account Key.
    /// </summary>
    public string? EncryptedAccountPrivateKey { get; }
}
