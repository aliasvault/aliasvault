//-----------------------------------------------------------------------
// <copyright file="RecipientDomainMailboxFilter.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.SmtpService.Handlers;

using SmtpServer;
using SmtpServer.Mail;
using SmtpServer.Protocol;
using SmtpServer.Storage;

/// <summary>
/// Mailbox filter that rejects recipients outside configured managed domains during RCPT TO.
/// </summary>
/// <param name="config">SMTP service configuration.</param>
/// <param name="logger">ILogger instance.</param>
public class RecipientDomainMailboxFilter(Config config, ILogger<RecipientDomainMailboxFilter> logger) : MailboxFilter
{
    /// <summary>
    /// Validate sender mailbox.
    /// </summary>
    /// <param name="context">The SMTP session context for the current connection.</param>
    /// <param name="from">The sender mailbox from the MAIL FROM command.</param>
    /// <param name="size">The declared message size in bytes.</param>
    /// <param name="cancellationToken">A token that can cancel the asynchronous operation.</param>
    /// <returns>A task containing <see langword="true" /> when the sender is accepted.</returns>
    public override Task<bool> CanAcceptFromAsync(ISessionContext context, IMailbox @from, int size, CancellationToken cancellationToken)
    {
        return Task.FromResult(true);
    }

    /// <summary>
    /// Validate recipient mailbox during RCPT TO command.
    /// </summary>
    /// <param name="context">The SMTP session context for the current connection.</param>
    /// <param name="to">The recipient mailbox from the RCPT TO command.</param>
    /// <param name="from">The sender mailbox from the MAIL FROM command.</param>
    /// <param name="cancellationToken">A token that can cancel the asynchronous operation.</param>
    /// <returns>A task containing <see langword="true" /> when the recipient is accepted.</returns>
    public override Task<bool> CanDeliverToAsync(ISessionContext context, IMailbox to, IMailbox @from, CancellationToken cancellationToken)
    {
        if (IsAllowedRecipientDomain(to.Host))
        {
            return Task.FromResult(true);
        }

        logger.LogInformation(
            "Rejected RCPT TO for recipient domain {RecipientDomain}: domain is not managed by this instance.",
            to.Host);

        // Use 550 to mirror typical "relay not permitted" behavior and keep client behavior consistent.
        throw new SmtpResponseException(new SmtpResponse(SmtpReplyCode.MailboxUnavailable, "Relay not permitted"));
    }

    private bool IsAllowedRecipientDomain(string? domain)
    {
        if (string.IsNullOrWhiteSpace(domain))
        {
            return false;
        }

        var normalizedDomain = domain.Trim().ToLowerInvariant();
        return config.AllowedToDomains.Contains(normalizedDomain);
    }
}
