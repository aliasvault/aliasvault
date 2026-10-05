//-----------------------------------------------------------------------
// <copyright file="RegisterRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Auth;

using AliasVault.Shared.Models.WebApi.V2.Vault;

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
    /// <param name="encryptedVek">The AK encrypted VEK.</param>
    /// <param name="encryptedAccountKey">The KEK encrypted Account Key.</param>
    /// <param name="accountPublicKey">The account public key.</param>
    /// <param name="encryptedAccountPrivateKey">The AK encrypted account private key.</param>
    /// <param name="signingPublicKey">The account signing public key.</param>
    /// <param name="encryptedSigningPrivateKey">The AK encrypted account signing private key.</param>
    /// <param name="accountPublicKeySignature">The signing key's signature over the account public key.</param>
    /// <param name="srpIdentity">The SRP identity.</param>
    public RegisterRequest(string username, string salt, string verifier, string encryptionType, string encryptionSettings, string encryptedVek, string encryptedAccountKey, string accountPublicKey, string encryptedAccountPrivateKey, string signingPublicKey, string encryptedSigningPrivateKey, string accountPublicKeySignature, string srpIdentity)
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
        SigningPublicKey = signingPublicKey;
        EncryptedSigningPrivateKey = encryptedSigningPrivateKey;
        AccountPublicKeySignature = accountPublicKeySignature;
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
    public string SrpIdentity { get; }

    /// <summary>
    /// Gets the encrypted VEK.
    /// </summary>
    public string? EncryptedVek { get; }

    /// <summary>
    /// Gets the Account Key encrypted with the KEK derived from the password.
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

    /// <summary>
    /// Gets the account signing public key.
    /// </summary>
    public string? SigningPublicKey { get; }

    /// <summary>
    /// Gets the account signing private key encrypted with the Account Key.
    /// </summary>
    public string? EncryptedSigningPrivateKey { get; }

    /// <summary>
    /// Gets the signing key's signature over <see cref="AccountPublicKey"/>.
    /// </summary>
    public string? AccountPublicKeySignature { get; }

    /// <summary>
    /// Gets the algorithm of <see cref="EncryptedAccountKey"/>, as a VaultKeyAlgorithm token.
    /// </summary>
    public string? EncryptedAccountKeyAlgorithm { get; init; }

    /// <summary>
    /// Gets the registration invite code, required when public registration is disabled.
    /// </summary>
    public string? InviteCode { get; init; }

    /// <summary>
    /// Gets a value indicating whether the client sent the complete account key hierarchy. A partial one is not usable.
    /// </summary>
    public bool HasCompleteAccountKeys => !string.IsNullOrEmpty(EncryptedVek) && !string.IsNullOrEmpty(EncryptedAccountKey) && !string.IsNullOrEmpty(EncryptedAccountKeyAlgorithm) && !string.IsNullOrEmpty(AccountPublicKey) && !string.IsNullOrEmpty(EncryptedAccountPrivateKey)
        && !string.IsNullOrEmpty(SigningPublicKey) && !string.IsNullOrEmpty(EncryptedSigningPrivateKey) && !string.IsNullOrEmpty(AccountPublicKeySignature);

    /// <summary>
    /// Gets a value indicating whether every account key fits its storage column, so an oversized value is a validation error instead of a half-created account.
    /// </summary>
    public bool AccountKeysFitStorageLimits => (EncryptedVek?.Length ?? 0) <= AccountKeysUpload.MaxWrappedKeyLength && (EncryptedAccountKey?.Length ?? 0) <= AccountKeysUpload.MaxWrappedKeyLength && (AccountPublicKey?.Length ?? 0) <= AccountKeysUpload.MaxPublicKeyLength && (EncryptedAccountPrivateKey?.Length ?? 0) <= AccountKeysUpload.MaxEncryptedPrivateKeyLength
        && (SigningPublicKey?.Length ?? 0) <= AccountKeysUpload.MaxSigningPublicKeyLength && (EncryptedSigningPrivateKey?.Length ?? 0) <= AccountKeysUpload.MaxSigningValueLength && (AccountPublicKeySignature?.Length ?? 0) <= AccountKeysUpload.MaxSigningValueLength;
}
