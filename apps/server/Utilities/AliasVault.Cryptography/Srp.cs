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
    /// Generate the server's ephemeral pair for a verifier.
    /// </summary>
    /// <param name="verifier">The account's verifier.</param>
    /// <returns>The ephemeral pair.</returns>
    public static SrpEphemeral GenerateEphemeralServer(string verifier)
    {
        return new SrpServer().GenerateEphemeral(verifier);
    }

    /// <summary>
    /// Derive the server session, which checks the client's proof.
    /// </summary>
    /// <param name="serverEphemeralSecret">The server's secret ephemeral.</param>
    /// <param name="clientEphemeralPublic">The client's public ephemeral.</param>
    /// <param name="salt">The account's salt.</param>
    /// <param name="username">The SRP identity; lowercased, as SRP is case sensitive.</param>
    /// <param name="verifier">The account's verifier.</param>
    /// <param name="clientSessionProof">The client's session proof.</param>
    /// <returns>The session, or null when the proof is wrong or malformed.</returns>
    public static SrpSession? DeriveSessionServer(string serverEphemeralSecret, string clientEphemeralPublic, string salt, string username, string verifier, string clientSessionProof)
    {
        try
        {
            return new SrpServer().DeriveSession(serverEphemeralSecret, clientEphemeralPublic, salt, username.ToLowerInvariant(), verifier, clientSessionProof);
        }
        catch (System.Security.SecurityException)
        {
            // Wrong password.
            return null;
        }
        catch (FormatException)
        {
            // Non-hexadecimal ephemeral or proof.
            return null;
        }
    }
}
