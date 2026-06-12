//-----------------------------------------------------------------------
// <copyright file="ValidateLoginRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V1.Auth
{
    /// <summary>
    /// Represents a request to validate a login.
    /// </summary>
    public class ValidateLoginRequest
    {
        /// <summary>
        /// Initializes a new instance of the <see cref="ValidateLoginRequest"/> class.
        /// </summary>
        /// <param name="username">Username.</param>
        /// <param name="rememberMe">Indicates if the user wants to be remembered which extends the refresh token lifetime.</param>
        /// <param name="clientPublicEphemeral">Client public ephemeral.</param>
        /// <param name="clientSessionProof">Client session proof.</param>
        public ValidateLoginRequest(string username, bool rememberMe, string clientPublicEphemeral, string clientSessionProof)
        {
            Username = username.ToLowerInvariant().Trim();
            RememberMe = rememberMe;
            ClientPublicEphemeral = clientPublicEphemeral;
            ClientSessionProof = clientSessionProof;
        }

        /// <summary>
        /// Gets the username.
        /// </summary>
        public string Username { get; }

        /// <summary>
        /// Gets a value indicating whether the user wants to be remembered which extends the refresh token lifetime.
        /// </summary>
        public bool RememberMe { get; }

        /// <summary>
        /// Gets the client's public ephemeral value.
        /// </summary>
        public string ClientPublicEphemeral { get; }

        /// <summary>
        /// Gets the client's session proof.
        /// </summary>
        public string ClientSessionProof { get; }
    }
}
