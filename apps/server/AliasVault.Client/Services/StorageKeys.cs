//-----------------------------------------------------------------------
// <copyright file="StorageKeys.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services;

/// <summary>
/// Contains all localStorage key constants used throughout the application.
/// Centralizing these keys helps prevent typos and makes it easier to track what data is stored locally.
/// </summary>
public static class StorageKeys
{
    /// <summary>
    /// Key for storing the JWT access token.
    /// </summary>
    public const string AccessToken = "token";

    /// <summary>
    /// Key for storing the JWT refresh token.
    /// </summary>
    public const string RefreshToken = "refreshToken";

    /// <summary>
    /// Key for storing the encrypted test string used to validate the encryption key locally.
    /// </summary>
    public const string EncryptionTestString = "encryptionTestString";

    /// <summary>
    /// Key for storing whether WebAuthn is enabled for vault unlock.
    /// </summary>
    public const string WebAuthnEnabled = "webAuthnEnabled";

    /// <summary>
    /// Key for storing the WebAuthn credential ID.
    /// </summary>
    public const string WebAuthnCredentialId = "webAuthnCredentialId";

    /// <summary>
    /// Key for storing the WebAuthn salt used for key derivation.
    /// </summary>
    public const string WebAuthnSalt = "webAuthnSalt";

    /// <summary>
    /// Key for storing the WebAuthn credential derived key.
    /// </summary>
    public const string WebAuthnCredentialDerivedKey = "webAuthnCredentialDerivedKey";

    /// <summary>
    /// Key for storing the encrypted encryption key for WebAuthn.
    /// </summary>
    public const string WebAuthnEncryptedEncryptionKey = "webAuthnEncryptedEncryptionKey";

    /// <summary>
    /// Key for storing the user's language preference (used before authentication).
    /// </summary>
    public const string AppLanguage = "AppLanguage";

    /// <summary>
    /// Key for storing the return URL to redirect to after login or unlock.
    /// </summary>
    public const string ReturnUrl = "returnUrl";
}
