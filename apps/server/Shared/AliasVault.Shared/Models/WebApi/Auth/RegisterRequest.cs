//-----------------------------------------------------------------------
// <copyright file="RegisterRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.Auth;

/// <summary>
/// Register request model.
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
    public RegisterRequest(string username, string salt, string verifier, string encryptionType, string encryptionSettings, string? srpIdentity = null)
    {
        Username = username.ToLowerInvariant().Trim();
        Salt = salt;
        Verifier = verifier;
        EncryptionType = encryptionType;
        EncryptionSettings = encryptionSettings;
        SrpIdentity = srpIdentity;
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
}
