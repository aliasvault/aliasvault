//-----------------------------------------------------------------------
// <copyright file="EmailDomainHelper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Builds the email domain lists the status endpoint reports.
/// </summary>
public static class EmailDomainHelper
{
    /// <summary>
    /// The public (SpamOK) email domains available to every client.
    /// </summary>
    private static readonly string[] PublicEmailDomains = ["spamok.com", "solarflarecorp.com", "spamok.nl", "3060.nl", "landmail.nl", "asdasd.nl", "spamok.de", "spamok.com.ua", "spamok.es", "spamok.fr"];

    /// <summary>
    /// Gets the email domains this server serves.
    /// </summary>
    /// <param name="config">The API config.</param>
    /// <returns>The email domain lists.</returns>
    public static EmailDomains GetEmailDomains(Config config)
    {
        return new EmailDomains
        {
            PrivateEmailDomainList = config.PrivateEmailDomains,
            HiddenPrivateEmailDomainList = config.HiddenPrivateEmailDomains,
            PublicEmailDomainList = [.. PublicEmailDomains],
        };
    }
}
