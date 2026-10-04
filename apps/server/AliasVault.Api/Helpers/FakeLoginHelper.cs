//-----------------------------------------------------------------------
// <copyright file="FakeLoginHelper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using System.Security.Cryptography;
using System.Text;
using AliasVault.Api.Models;
using AliasVault.Shared.Server.Utilities;
using SecureRemotePassword;

/// <summary>
/// Creates the SRP values for a username that does not exist, derived from an HMAC of the username under a server
/// secret, so they are the same on every request, API instance and restart, like those of a real account.
/// </summary>
public static class FakeLoginHelper
{
    private static readonly Lazy<byte[]> ProfileKey = new(() => HKDF.DeriveKey(HashAlgorithmName.SHA256, Encoding.UTF8.GetBytes(SecretReader.GetJwtKey()), 32, info: Encoding.UTF8.GetBytes("AliasVault fake login profile")));

    /// <summary>
    /// Gets the fake login profile for a username that does not exist.
    /// </summary>
    /// <param name="username">The username as the client sent it.</param>
    /// <returns>The fake login profile.</returns>
    public static FakeLoginProfile Create(string username) => Create(ProfileKey.Value, username);

    /// <summary>
    /// Derives the fake login profile of a username from a key.
    /// </summary>
    /// <param name="key">The secret key.</param>
    /// <param name="username">The username as the client sent it.</param>
    /// <returns>The fake login profile.</returns>
    public static FakeLoginProfile Create(byte[] key, string username)
    {
        // Normalized like the username lookup, so usernames that resolve to the same account get the same profile.
        var digest = HMACSHA512.HashData(key, Encoding.UTF8.GetBytes(username.ToUpperInvariant()));

        // Uppercase hex and a lowercase version 4 GUID, like the salt and SRP identity current clients create.
        var salt = Convert.ToHexString(digest, 0, 32);
        var identityBytes = digest.AsSpan(32, 16).ToArray();
        identityBytes[6] = (byte)((identityBytes[6] & 0x0F) | 0x40);
        identityBytes[8] = (byte)((identityBytes[8] & 0x3F) | 0x80);
        var srpIdentity = new Guid(identityBytes, bigEndian: true).ToString();

        var client = new SrpClient();
        var verifier = client.DeriveVerifier(client.DerivePrivateKey(salt, srpIdentity, Convert.ToHexString(digest, 48, 16)));

        return new FakeLoginProfile(salt, verifier, srpIdentity);
    }
}
