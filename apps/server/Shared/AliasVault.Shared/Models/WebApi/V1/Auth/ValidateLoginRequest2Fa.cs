//-----------------------------------------------------------------------
// <copyright file="ValidateLoginRequest2Fa.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V1.Auth
{
    /// <summary>
    /// Represents a request to validate a login with added 2-factor authentication code.
    /// </summary>
    public class ValidateLoginRequest2Fa : ValidateLoginRequest
    {
        /// <summary>
        /// Initializes a new instance of the <see cref="ValidateLoginRequest2Fa"/> class.
        /// </summary>
        /// <param name="username">Username.</param>
        /// <param name="rememberMe">Indicates if the user wants to be remembered which extends the refresh token lifetime.</param>
        /// <param name="clientPublicEphemeral">Client public ephemeral.</param>
        /// <param name="clientSessionProof">Client session proof.</param>
        /// <param name="code2Fa">2-factor authentication code.</param>
        public ValidateLoginRequest2Fa(string username, bool rememberMe, string clientPublicEphemeral, string clientSessionProof, int code2Fa)
            : base(username, rememberMe, clientPublicEphemeral, clientSessionProof)
        {
            Code2Fa = code2Fa;
        }

        /// <summary>
        /// Gets the 2-factor authentication code.
        /// </summary>
        public int Code2Fa { get; }
    }
}
