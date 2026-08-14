//-----------------------------------------------------------------------
// <copyright file="DatabaseMessageStore.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.SmtpService.Handlers;

using System.Buffers;
using System.Globalization;
using System.IO.Compression;
using System.Net.Mail;
using System.Text.RegularExpressions;
using AliasServerDb;
using AliasVault.Cryptography.Server;
using Microsoft.EntityFrameworkCore;
using MimeKit;
using MimeKit.IO;
using NUglify;
using SmtpServer;
using SmtpServer.Mail;
using SmtpServer.Protocol;
using SmtpServer.Storage;

/// <summary>
/// Database message store.
/// </summary>
/// <param name="logger">ILogger instance.</param>
/// <param name="config">Config instance.</param>
/// <param name="dbContextFactory">IDbContextFactory instance.</param>
public class DatabaseMessageStore(ILogger<DatabaseMessageStore> logger, Config config, IAliasServerDbContextFactory dbContextFactory) : MessageStore
{
    /// <summary>
    /// Attachment bodies smaller than this are left inline in the message source. Detaching them would trade a
    /// download saving too small to notice for an extra round trip whenever the user opens the attachment.
    /// </summary>
    private const int DetachedPartMinimumSizeInBytes = 64 * 1024;

    /// <summary>
    /// Header stamped on a detached part carrying the index its body is stored and requested under. Clients
    /// read it from the part headers, so the index never depends on how a given MIME parser orders attachments.
    /// </summary>
    private const string DetachedPartIndexHeader = "X-AliasVault-Part";

    /// <summary>
    /// Header stamped on a detached part carrying the decoded size of the attachment, so clients can show the
    /// file size in the attachment list without downloading the body first.
    /// </summary>
    private const string DetachedPartLengthHeader = "X-AliasVault-Detached-Length";

    /// <summary>
    /// Override the SaveAsync method to save the email into the database.
    /// </summary>
    /// <param name="context">ISessionContext instance.</param>
    /// <param name="transaction">IMessageTransaction instance.</param>
    /// <param name="buffer">Buffer which contains the email contents.</param>
    /// <param name="cancellationToken">CancellationToken instance.</param>
    /// <returns>SmtpResponse.</returns>
    public override async Task<SmtpResponse> SaveAsync(ISessionContext context, IMessageTransaction transaction, ReadOnlySequence<byte> buffer, CancellationToken cancellationToken)
    {
        try
        {
            // Check email size limit
            var maxEmailSizeInMegabytes = 10;
            var maxEmailSizeInBytes = (long)((maxEmailSizeInMegabytes * 1024 * 1024) * 1.4);
            if (buffer.Length > maxEmailSizeInBytes)
            {
                return SmtpResponse.SizeLimitExceeded;
            }

            var message = await LoadMessageFromBuffer(buffer, cancellationToken);

            // Detach the large attachments once, up front: this mutates the message into the skeleton that every
            // recipient's copy is serialized from, so it must not run again inside the per-recipient loop.
            var detachedParts = DetachLargeAttachments(message);

            // Retrieve all addresses from the SMTP transaction which should contain all recipients for this mail instance.
            var allAddresses = transaction.To
                .Distinct()
                .ToList();

            // Limit list to 15 addresses maximum to prevent mailbomb/spam abuse.
            var toAddresses = allAddresses.Take(15).ToList();

            var toAddressesCount = toAddresses.Count;
            var toAddressesFailCount = 0;
            foreach (var toAddress in toAddresses)
            {
                // Process the email for each recipient separately.
                var process = await ProcessEmailForRecipient(message, detachedParts, toAddress);
                if (!process)
                {
                    toAddressesFailCount++;
                }

                // If all recipients failed, return error to sender.
                if (toAddressesFailCount == toAddressesCount)
                {
                    // No valid recipients given.
                    logger.LogDebug("No valid recipients in email, returning error to sender.");
                    return SmtpResponse.NoValidRecipientsGiven;
                }
            }

            return SmtpResponse.Ok;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error saving email into database.");
            return SmtpResponse.MailboxUnavailable;
        }
    }

    /// <summary>
    /// Load the email message from the buffer.
    /// </summary>
    /// <param name="buffer">Buffer which contains the email contents.</param>
    /// <param name="cancellationToken">CancellationToken instance.</param>
    /// <returns>MimeMessage.</returns>
    private static async Task<MimeMessage> LoadMessageFromBuffer(ReadOnlySequence<byte> buffer, CancellationToken cancellationToken)
    {
        await using var stream = new MemoryStream();

        var position = buffer.GetPosition(0);
        while (buffer.TryGet(ref position, out var memory))
        {
            stream.Write(memory.Span);
        }

        stream.Position = 0;
        return await MimeMessage.LoadAsync(stream, cancellationToken);
    }

    /// <summary>
    /// Convert MimeMessage to Email database object.
    /// </summary>
    /// <param name="message">MimeMessage object.</param>
    /// <param name="detachedParts">The attachment bodies detached from the message source at ingest.</param>
    /// <param name="toAddress">The recipient for this mail.</param>
    /// <returns>Email object.</returns>
    private static Email ConvertMimeMessageToEmail(MimeMessage message, IReadOnlyCollection<DetachedPart> detachedParts, MailAddress toAddress)
    {
        var from = string.Empty;

        try
        {
            from = message.From.FirstOrDefault()?.ToString() ?? string.Empty;
        }
        catch
        {
            // Do nothing.
        }

        string fromLocal;
        string fromDomain;

        // Try to extract from address firstly from "from" in the mail.
        try
        {
            MailAddress fromAddress = new MailAddress(message.From.FirstOrDefault()?.ToString() ?? string.Empty);
            fromLocal = fromAddress.User;
            fromDomain = fromAddress.Host;
        }
        catch
        {
            // If this fails, then simply use a blank value.
            fromLocal = string.Empty;
            fromDomain = string.Empty;
        }

        // Create email object. The gzipped raw source is the single authoritative copy of the body content:
        // clients derive the html/plain bodies and attachments by parsing it after decrypt+gunzip.
        var email = new Email
        {
            From = from,
            FromLocal = fromLocal.ToLower(),
            FromDomain = fromDomain.ToLower(),
            To = toAddress.Address.ToLower(),
            ToLocal = toAddress.User.ToLower(),
            ToDomain = toAddress.Host.ToLower(),
            Subject = message.Subject ?? string.Empty,
            MessageSourceBytes = CompressMessageSource(message),
            AttachmentCount = message.Attachments.Count(),
            Date = message.Date.DateTime.ToUniversalTime(),
            DateSystem = DateTime.UtcNow,
            Visible = true,
        };

        // Extract a preview of the email message body to be used in the email listing preview in the UI.
        email.MessagePreview = ExtractMessagePreview(message.TextBody, message.HtmlBody);

        // Add the detached parts to the email.
        foreach (var part in detachedParts)
        {
            email.Parts.Add(new EmailPart { PartIndex = part.PartIndex, Bytes = part.Bytes });
        }

        return email;
    }

    /// <summary>
    /// Serialize the full RFC 822 message and gzip-compress it.
    /// </summary>
    /// <param name="message">MimeMessage object.</param>
    /// <returns>Gzip-compressed raw message source.</returns>
    private static byte[] CompressMessageSource(MimeMessage message)
    {
        using var output = new MemoryStream();
        using (var gzip = new GZipStream(output, CompressionLevel.Optimal, leaveOpen: true))
        {
            message.WriteTo(gzip);
        }

        return output.ToArray();
    }

    /// <summary>
    /// Gzip-compress a byte array.
    /// </summary>
    /// <param name="bytes">The bytes to compress.</param>
    /// <returns>Gzip-compressed bytes.</returns>
    private static byte[] Compress(byte[] bytes)
    {
        using var output = new MemoryStream();
        using (var gzip = new GZipStream(output, CompressionLevel.Optimal, leaveOpen: true))
        {
            gzip.Write(bytes, 0, bytes.Length);
        }

        return output.ToArray();
    }

    /// <summary>
    /// Move the body of every sizeable attachment out of the message and into a separately stored part, leaving
    /// the message a valid MIME skeleton: the attachment keeps its headers (and therefore its filename and MIME
    /// type, which stay encrypted along with the rest of the source) but carries an empty body plus the two
    /// X-AliasVault-* headers that tell clients where to fetch it and how large it is.
    ///
    /// The captured body is the transfer-encoded form exactly as it appeared in the source, so splicing it back in
    /// is a plain byte insert in case client wants to fully reconstruct the message source.
    /// </summary>
    /// <param name="message">MimeMessage to detach the attachments from. Mutated in place.</param>
    /// <returns>The detached parts, in the order they were stamped.</returns>
    private static List<DetachedPart> DetachLargeAttachments(MimeMessage message)
    {
        var detached = new List<DetachedPart>();
        foreach (var part in message.BodyParts.OfType<MimePart>())
        {
            if (!part.IsAttachment || part.Content is null)
            {
                continue;
            }

            using var encoded = new MemoryStream();
            part.Content.WriteTo(encoded);
            if (encoded.Length < DetachedPartMinimumSizeInBytes)
            {
                continue;
            }

            using var measuring = new MeasuringStream();
            part.Content.DecodeTo(measuring);

            var partIndex = detached.Count;
            part.Headers[DetachedPartIndexHeader] = partIndex.ToString(CultureInfo.InvariantCulture);
            part.Headers[DetachedPartLengthHeader] = measuring.Length.ToString(CultureInfo.InvariantCulture);

            var encoding = part.Content.Encoding;
            part.Content = new MimeContent(new MemoryStream([], false), encoding);

            detached.Add(new DetachedPart(partIndex, Compress(encoded.ToArray())));
        }

        return detached;
    }

    /// <summary>
    /// Extracts a preview of the email message body to be used in the email listing preview in the UI.
    /// This so the client does not need to load the full email body when rendering a list.
    /// </summary>
    /// <param name="messagePlain">The parsed plain text body of the message, if any.</param>
    /// <param name="messageHtml">The parsed HTML body of the message, if any.</param>
    /// <returns>Email preview as string.</returns>
    private static string ExtractMessagePreview(string? messagePlain, string? messageHtml)
    {
        var messagePreview = string.Empty;
        const int maxPreviewLength = 180;

        try
        {
            if (messagePlain != null && !string.IsNullOrEmpty(messagePlain) && messagePlain.Length > 3)
            {
                // Decode HTML entities (e.g., &#39; -> ', &amp; -> &)
                string plainToPlainText = System.Net.WebUtility.HtmlDecode(messagePlain);

                // Replace any newline characters with a space
                plainToPlainText = Regex.Replace(plainToPlainText, @"\t|\n|\r", " ", RegexOptions.NonBacktracking);

                // Remove all "-" or "=" characters if there are 3 or more in a row
                plainToPlainText = Regex.Replace(plainToPlainText, @"-{3,}|\={3,}", string.Empty, RegexOptions.NonBacktracking);

                // Remove control characters while preserving printable Unicode such as accented letters and emoji.
                plainToPlainText = Regex.Replace(plainToPlainText, @"\p{Cc}", string.Empty, RegexOptions.NonBacktracking);

                // Replace multiple spaces with a single space
                plainToPlainText = Regex.Replace(plainToPlainText, @"\s+", " ", RegexOptions.NonBacktracking);

                // Trim start and end of string
                plainToPlainText = plainToPlainText.Trim();

                messagePreview = plainToPlainText.Length > maxPreviewLength
                    ? plainToPlainText.Substring(0, maxPreviewLength)
                    : plainToPlainText;
            }
            else if (messageHtml != null)
            {
                string htmlToPlainText = Uglify.HtmlToText(messageHtml).ToString();

                // Decode HTML entities (e.g., &#39; -> ', &amp; -> &)
                htmlToPlainText = System.Net.WebUtility.HtmlDecode(htmlToPlainText);

                // Replace any newline characters with a space
                htmlToPlainText = Regex.Replace(htmlToPlainText, @"\t|\n|\r", string.Empty, RegexOptions.NonBacktracking);

                // Remove all "-" or "=" characters if there are 3 or more in a row
                htmlToPlainText = Regex.Replace(htmlToPlainText, @"-{3,}|\={3,}", string.Empty, RegexOptions.NonBacktracking);

                // Remove control characters while preserving printable Unicode such as accented letters and emoji.
                htmlToPlainText = Regex.Replace(htmlToPlainText, @"\p{Cc}", string.Empty, RegexOptions.NonBacktracking);

                // Replace multiple spaces with a single space
                htmlToPlainText = Regex.Replace(htmlToPlainText, @"\s+", " ", RegexOptions.NonBacktracking);

                // Trim start and end of string
                htmlToPlainText = htmlToPlainText.Trim();

                messagePreview =
                    htmlToPlainText.Length > maxPreviewLength ? htmlToPlainText.Substring(0, maxPreviewLength) : htmlToPlainText;
            }
        }
        catch
        {
            // Extracting useful words from email failed. Skip the step, do nothing.
        }

        return messagePreview;
    }

    /// <summary>
    /// Process email for recipient separately.
    /// </summary>
    /// <param name="message">MimeMessage.</param>
    /// <param name="detachedParts">The attachment bodies detached from the message source at ingest.</param>
    /// <param name="toAddress">ToAddress.</param>
    /// <returns>True if success or silent skip, false if SmtpResponse.NoValidRecipientsGiven should be triggered.</returns>
    private async Task<bool> ProcessEmailForRecipient(MimeMessage message, IReadOnlyCollection<DetachedPart> detachedParts, IMailbox? toAddress)
    {
        // Check if toAddress domain is allowed.
        if (toAddress is null ||
            string.IsNullOrWhiteSpace(toAddress.Host) ||
            !config.AllowedToDomains.Contains(toAddress.Host.Trim().ToLowerInvariant()))
        {
            // ToAddress domain is not allowed.
            logger.LogInformation(
                "Rejected email: email for {ToAddress} is not allowed. Domain not in allowed domain list.",
                toAddress?.User + "@" + toAddress?.Host);
            return false;
        }

        // Check if the local part of the toAddress is a known alias (claimed by a user)
        await using var dbContext = await dbContextFactory.CreateDbContextAsync(CancellationToken.None);
        var toAddressLocal = toAddress.User.ToLowerInvariant();
        var toAddressDomain = toAddress.Host.ToLowerInvariant();
        var emailClaim = await dbContext.EmailClaims
            .FirstOrDefaultAsync(
                x =>
                    x.AddressLocal == toAddressLocal &&
                    x.AddressDomain == toAddressDomain,
                CancellationToken.None);

        if (emailClaim is null)
        {
            // Email address has no user claim with corresponding encryption key, so we cannot process it.
            logger.LogInformation(
                "Rejected email: email for {ToAddress} is not allowed. No user claim on this ToAddress.",
                toAddress.User + "@" + toAddress.Host);
            return false;
        }

        // An alias may be claimed by several manifests at once (personal + shared). The mail is stored once, with
        // the symmetric key wrapped per linked manifest's primary delivery key.
        var links = await dbContext.EmailClaimLinks.Where(l => l.EmailClaimId == emailClaim.Id).Select(l => new { l.VaultManifestId, l.State }).ToListAsync(CancellationToken.None);
        if (links.Count == 0)
        {
            // The claim is orphaned: every manifest it was linked to no longer exists (owner deleted account).
            logger.LogInformation(
                "Rejected email: email for {ToAddress} is claimed but its owning vault no longer exists. The owner has most likely deleted their account.",
                toAddress.User + "@" + toAddress.Host);
            return false;
        }

        // Check if the email claim is disabled.
        if (emailClaim.Disabled)
        {
            // Email claim is disabled, so we cannot process this email.
            logger.LogInformation(
                "Rejected email: email for {ToAddress} is claimed but is disabled which means the user has deleted the email alias.",
                toAddress.User + "@" + toAddress.Host);
            return false;
        }

        // Check if there is at least one manifest that still carries the alias and wants its mail.
        var linkedManifestIds = links.Where(l => l.State == EmailClaimLinkState.Active).Select(l => l.VaultManifestId).ToList();
        if (linkedManifestIds.Count == 0)
        {
            logger.LogInformation(
                "Rejected email: email for {ToAddress} is claimed but every vault that still carries it has the alias switched off.",
                toAddress.User + "@" + toAddress.Host);
            return false;
        }

        // Resolve every linked manifest's primary delivery key.
        var deliveryKeys = await dbContext.VaultManifestDeliveryKeys.Where(x => linkedManifestIds.Contains(x.VaultManifestId) && x.IsPrimary).ToListAsync(CancellationToken.None);
        foreach (var keylessManifestId in linkedManifestIds.Except(deliveryKeys.Select(k => k.VaultManifestId)))
        {
            logger.LogWarning("Manifest {ManifestId} claims alias {ToAddress} but has no primary delivery key published; it gets no wrap for this email.", keylessManifestId, toAddress.User + "@" + toAddress.Host);
        }

        if (deliveryKeys.Count == 0)
        {
            // No linked manifest has a published primary delivery key, so we cannot process this email.
            logger.LogCritical(
                "Rejected email: email for {ToAddress} cannot be processed. No primary delivery encryption key found for any of its manifests.",
                toAddress.User + "@" + toAddress.Host);
            return false;
        }

        // Resolve the groups that own the wrapped-for manifests, only used to increment their EmailsReceived counters.
        var wrappedManifestIds = deliveryKeys.Select(k => k.VaultManifestId).ToList();
        var recipientGroupIds = await dbContext.VaultManifests.Where(m => wrappedManifestIds.Contains(m.ManifestId)).Select(m => m.OwnerGroupId).Distinct().ToListAsync(CancellationToken.None);

        var insertedId = await InsertEmailIntoDatabase(message, detachedParts, new MailAddress(toAddress.AsAddress()), deliveryKeys, recipientGroupIds, emailClaim.Id, emailClaim.AnonymizedSenderCounted);
        logger.LogDebug("Email for {ToAddress} successfully saved into database with ID {InsertedId}.", toAddress.User + "@" + toAddress.Host, insertedId);
        return true;
    }

    /// <summary>
    /// Insert email into database.
    /// </summary>
    /// <param name="message">MimeMessage to save into database.</param>
    /// <param name="detachedParts">The attachment bodies detached from the message source at ingest.</param>
    /// <param name="toAddress">The recipient for this mail.</param>
    /// <param name="deliveryKeys">The delivery keys of every manifest claiming this alias; each gets its own wrap of the email's symmetric key.</param>
    /// <param name="recipientGroupIds">The groups that own the manifests this alias is claimed by.</param>
    /// <param name="emailClaimId">The claim on the recipient alias, latched when its anonymized sender bucket is counted.</param>
    /// <param name="senderAlreadyCounted">Whether the sender is already counted for anonymized sender usage detection.</param>
    private async Task<int> InsertEmailIntoDatabase(MimeMessage message, IReadOnlyCollection<DetachedPart> detachedParts, MailAddress toAddress, IReadOnlyCollection<VaultManifestDeliveryKey> deliveryKeys, IReadOnlyCollection<Guid> recipientGroupIds, Guid emailClaimId, bool senderAlreadyCounted)
    {
        await using var dbContext = await dbContextFactory.CreateDbContextAsync();

        var newEmail = ConvertMimeMessageToEmail(message, detachedParts, toAddress);

        var senderHost = newEmail.FromDomain;
        newEmail = EmailEncryption.EncryptEmail(newEmail, deliveryKeys);

        // Insert the email into the database.
        dbContext.Emails.Add(newEmail);

        await dbContext.SaveChangesAsync();

        await IncrementEmailsReceived(dbContext, recipientGroupIds);
        await RecordAnonymizedSenderBucket(dbContext, emailClaimId, senderAlreadyCounted, senderHost, recipientGroupIds);

        return newEmail.Id;
    }

    /// <summary>
    /// Increment the EmailsReceived counter for every recipient group.
    /// </summary>
    /// <param name="dbContext">The context the email was inserted with.</param>
    /// <param name="recipientGroupIds">The groups that own the manifests this alias is claimed by.</param>
    private async Task IncrementEmailsReceived(AliasServerDbContext dbContext, IReadOnlyCollection<Guid> recipientGroupIds)
    {
        try
        {
            var groupIds = recipientGroupIds.ToArray();
            await dbContext.Database.ExecuteSqlAsync($"UPDATE \"Groups\" SET \"EmailsReceived\" = \"EmailsReceived\" + 1 WHERE \"Id\" = ANY({groupIds})");
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not increment the EmailsReceived counter for the recipient groups.");
        }
    }

    /// <summary>
    /// Record the sender host in the sender bucket for anonymized sender usage detection.
    /// </summary>
    /// <param name="dbContext">The context the email was inserted with.</param>
    /// <param name="emailClaimId">The claim on the recipient alias.</param>
    /// <param name="senderAlreadyCounted">Whether the sender is already counted for anonymized sender usage detection.</param>
    /// <param name="senderHost">The plaintext sender host, captured before encryption.</param>
    /// <param name="recipientGroupIds">The groups that own the manifests this alias is claimed by.</param>
    private async Task RecordAnonymizedSenderBucket(AliasServerDbContext dbContext, Guid emailClaimId, bool senderAlreadyCounted, string senderHost, IReadOnlyCollection<Guid> recipientGroupIds)
    {
        if (senderAlreadyCounted || string.IsNullOrWhiteSpace(config.AbuseMetricsSalt) || string.IsNullOrWhiteSpace(senderHost))
        {
            return;
        }

        try
        {
            // Set the sender already counted flag for the email claim.
            var latched = await dbContext.Database.ExecuteSqlAsync($"UPDATE \"EmailClaims\" SET \"AnonymizedSenderCounted\" = true WHERE \"Id\" = {emailClaimId} AND \"AnonymizedSenderCounted\" = false");
            if (latched == 0)
            {
                return;
            }

            // Compute the bucket index for the sender host and increment the count for the recipient groups.
            var position = AnonymizedSenderBucket.Compute(config.AbuseMetricsSalt, senderHost) + 1;
            var groupIds = recipientGroupIds.ToArray();

            await dbContext.Database.ExecuteSqlAsync(
                $"""
                 UPDATE "Groups"
                 SET "AnonymizedEmailAliasSenderCounts"[{position}] = COALESCE("AnonymizedEmailAliasSenderCounts"[{position}], 0) + 1
                 WHERE "Id" = ANY({groupIds}) AND array_length("AnonymizedEmailAliasSenderCounts", 1) >= {position}
                 """);
        }
        catch (Exception ex)
        {
            // Could not record the anonymized sender bucket for email claim. The email itself was stored and delivered normally.
            logger.LogWarning(ex, "Could not record the anonymized sender bucket for email claim {EmailClaimId}. The email itself was stored and delivered normally.", emailClaimId);
        }
    }

    /// <summary>
    /// An attachment body lifted out of the message source at ingest, ready to be stored as an EmailPart row
    /// for every recipient of the message.
    /// </summary>
    /// <param name="PartIndex">The index stamped on the part in the source as the X-AliasVault-Part header.</param>
    /// <param name="Bytes">The transfer-encoded part body, gzip-compressed but not yet encrypted.</param>
    private sealed record DetachedPart(int PartIndex, byte[] Bytes);
}
