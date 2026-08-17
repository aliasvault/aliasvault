//-----------------------------------------------------------------------
// <copyright file="Srp.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Cryptography.Client;

using AliasVault.Cryptography.Client.Models;
using SecureRemotePassword;

/// <summary>
/// SRP is a secure remote password protocol that allows a user to authenticate themselves
/// to a server without sending the password over the network.
/// </summary>
public static class Srp
{
    /// <summary>
    /// Prepare password change step used for both registration and actual password change.
    /// </summary>
    /// <param name="client">SrpClient.</param>
    /// <param name="salt">Salt.</param>
    /// <param name="username">Username.</param>
    /// <param name="passwordHashString">Hashed password string.</param>
    /// <returns>SrpSignup model.</returns>
    public static SrpPasswordChange PasswordChangeAsync(SrpClient client, string salt, string username, string passwordHashString)
    {
        // Derive a key from the password using Argon2id.
        // Make sure the username is lowercase as the SRP protocol is case sensitive.
        username = username.ToLowerInvariant();

        // Signup or password change: client generates a salt and verifier.
        var privateKey = DerivePrivateKey(salt, username, passwordHashString);
        var verifier = client.DeriveVerifier(privateKey);

        return new SrpPasswordChange(username, salt, privateKey, verifier);
    }

    /// <summary>
    /// Derive a private key for a user.
    /// </summary>
    /// <param name="salt">Salt.</param>
    /// <param name="username">Username.</param>
    /// <param name="passwordHashString">Hashed password string.</param>
    /// <returns>Private key as string.</returns>
    public static string DerivePrivateKey(string salt, string username, string passwordHashString)
    {
        // Make sure the username is lowercase as the SRP protocol is case sensitive.
        username = username.ToLowerInvariant();

        var client = new SrpClient();
        return client.DerivePrivateKey(salt, username, passwordHashString);
    }

    /// <summary>
    /// Generate an ephemeral value for the client.
    /// </summary>
    /// <returns>Ephemeral as string.</returns>
    public static SrpEphemeral GenerateEphemeralClient()
    {
        var client = new SrpClient();
        return client.GenerateEphemeral();
    }

    /// <summary>
    /// Generate an ephemeral value for the client.
    /// </summary>
    /// <param name="verifier">Verifier.</param>
    /// <returns>Ephemeral as string.</returns>
    public static SrpEphemeral GenerateEphemeralServer(string verifier)
    {
        var server = new SrpServer();
        return server.GenerateEphemeral(verifier);
    }

    /// <summary>
    /// Derive a shared session key on the client side.
    /// </summary>
    /// <param name="privateKey">Password hash.</param>
    /// <param name="clientSecretEphemeral">Client ephemeral secret.</param>
    /// <param name="serverEphemeralPublic">Server public ephemeral.</param>
    /// <param name="salt">Salt.</param>
    /// <param name="username">Username.</param>
    /// <returns>session.</returns>
    public static SrpSession DeriveSessionClient(string privateKey, string clientSecretEphemeral, string serverEphemeralPublic, string salt, string username)
    {
        // Make sure the username is lowercase as the SRP protocol is case sensitive.
        username = username.ToLowerInvariant();

        var client = new SrpClient();
        return client.DeriveSession(
            clientSecretEphemeral,
            serverEphemeralPublic,
            salt,
            username,
            privateKey);
    }

    /// <summary>
    /// Derive a shared session key on the server side.
    /// </summary>
    /// <param name="serverEphemeralSecret">serverEphemeralSecret.</param>
    /// <param name="clientEphemeralPublic">clientEphemeralPublic.</param>
    /// <param name="salt">Salt.</param>
    /// <param name="username">Username.</param>
    /// <param name="verifier">Verifier.</param>
    /// <param name="clientSessionProof">Client session proof.</param>
    /// <returns>SrpSession.</returns>
    public static SrpSession? DeriveSessionServer(string serverEphemeralSecret, string clientEphemeralPublic, string salt, string username, string verifier, string clientSessionProof)
    {
        // Make sure the username is lowercase as the SRP protocol is case sensitive.
        username = username.ToLowerInvariant();

        try
        {
            var server = new SrpServer();
            return server.DeriveSession(
                serverEphemeralSecret,
                clientEphemeralPublic,
                salt,
                username,
                verifier,
                clientSessionProof);
        }
        catch (System.Security.SecurityException)
        {
            // Incorrect password provided, return null.
            return null;
        }
        catch (FormatException)
        {
            // Malformed (non-hexadecimal) ephemeral or proof provided, return null.
            return null;
        }
    }

    /// <summary>
    /// Verify the session on the client side.
    /// </summary>
    /// <param name="clientEphemeralPublic">clientEphemeralPublic.</param>
    /// <param name="clientSession">clientSession.</param>
    /// <param name="serverSessionProof">serverSessionProof.</param>
    public static void VerifySession(string clientEphemeralPublic, SrpSession clientSession, string serverSessionProof)
    {
        var client = new SrpClient();
        client.VerifySession(clientEphemeralPublic, clientSession, serverSessionProof);
    }
}
