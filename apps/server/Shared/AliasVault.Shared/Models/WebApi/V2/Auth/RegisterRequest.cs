//-----------------------------------------------------------------------
// <copyright file="RegisterRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Auth;

/// <summary>
/// Register request model for the v2 endpoint. Includes the wrapped VEK so registration can create the user's
/// VaultKey (KEK/VEK model) atomically. When <see cref="WrappedVek"/> is omitted the user is registered on the
/// legacy model and migrates on their first vault upload from a KEK/VEK-capable client.
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
    /// <param name="wrappedVek">The wrapped VEK.</param>
    public RegisterRequest(string username, string salt, string verifier, string encryptionType, string encryptionSettings, string? srpIdentity = null, string? wrappedVek = null)
    {
        Username = username.ToLowerInvariant().Trim();
        Salt = salt;
        Verifier = verifier;
        EncryptionType = encryptionType;
        EncryptionSettings = encryptionSettings;
        SrpIdentity = srpIdentity;
        WrappedVek = wrappedVek;
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
    /// Gets the SRP identity used for authentication. This is a fixed value (typically a GUID) that
    /// is used for all SRP operations. If not provided, defaults to the lowercase username for
    /// backward compatibility.
    /// </summary>
    public string? SrpIdentity { get; }

    /// <summary>
    /// Gets the wrapped VEK: base64(IV ‖ ciphertext ‖ authTag) of the freshly generated VEK encrypted with the
    /// password-derived KEK using AES-256-GCM. Null for legacy registrations.
    /// </summary>
    public string? WrappedVek { get; }
}
