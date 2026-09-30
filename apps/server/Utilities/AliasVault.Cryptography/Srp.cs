//-----------------------------------------------------------------------
// <copyright file="Srp.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Cryptography;

using SecureRemotePassword;

/// <summary>
/// Server side of the SRP (secure remote password) protocol, which lets a user authenticate
/// without sending the password over the network. The client side lives in the Rust core.
/// </summary>
public static class Srp
{
    /// <summary>
    /// Generate an ephemeral value for the server.
    /// </summary>
    /// <param name="verifier">Verifier.</param>
    /// <returns>Ephemeral as string.</returns>
    public static SrpEphemeral GenerateEphemeralServer(string verifier)
    {
        var server = new SrpServer();
        return server.GenerateEphemeral(verifier);
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
}
