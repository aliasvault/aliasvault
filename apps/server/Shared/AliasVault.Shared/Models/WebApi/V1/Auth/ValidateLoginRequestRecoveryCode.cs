//-----------------------------------------------------------------------
// <copyright file="ValidateLoginRequestRecoveryCode.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V1.Auth
{
    /// <summary>
    /// Represents a request to validate a login with added 2-factor authentication code.
    /// </summary>
    public class ValidateLoginRequestRecoveryCode : ValidateLoginRequest
    {
        /// <summary>
        /// Initializes a new instance of the <see cref="ValidateLoginRequestRecoveryCode"/> class.
        /// </summary>
        /// <param name="username">Username.</param>
        /// <param name="rememberMe">Indicates if the user wants to be remembered which extends the refresh token lifetime.</param>
        /// <param name="clientPublicEphemeral">Client public ephemeral.</param>
        /// <param name="clientSessionProof">Client session proof.</param>
        /// <param name="recoveryCode">2-factor recovery code.</param>
        public ValidateLoginRequestRecoveryCode(string username, bool rememberMe, string clientPublicEphemeral, string clientSessionProof, string recoveryCode)
            : base(username, rememberMe, clientPublicEphemeral, clientSessionProof)
        {
            RecoveryCode = recoveryCode;
        }

        /// <summary>
        /// Gets the 2-factor authentication recovery code.
        /// </summary>
        public string RecoveryCode { get; }
    }
}
